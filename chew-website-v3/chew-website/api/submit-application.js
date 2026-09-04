// /api/submit-application.js
//
// Vercel serverless function. Requires DATABASE_URL, and (for scoring/email
// to actually run) ANTHROPIC_API_KEY, RESEND_API_KEY, FROM_EMAIL set in
// Vercel (Project → Settings → Environment Variables).
//
// Flow: validate → insert application → best-effort AI readiness scoring →
// best-effort applicant acknowledgment email. Scoring/email failures are
// logged but never fail the submission itself — an application must always
// be saved even if the AI or email provider is down or unconfigured.

const crypto = require('crypto');
const { query } = require('../lib/db');
const { scoreApplication } = require('../lib/scoring');
const { sendStartingPositionConfirmationEmail, sendOwnerNewApplicationNotice } = require('../lib/email');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fullName, email, phone, answers } = req.body || {};

    if (!fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Application answers are required.' });
    }

    const insertResult = await query(
      `INSERT INTO applications (access_token, full_name, email, phone, answers)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        crypto.randomUUID(),
        String(fullName).trim(),
        String(email).trim(),
        phone ? String(phone).trim() : null,
        JSON.stringify(answers),
      ]
    );
    const applicationId = insertResult.rows[0].id;

    try {
      const scored = await scoreApplication(answers);
      await query(
        `UPDATE applications
         SET ai_score = $1, ai_dimension_scores = $2, ai_recommendation = $3,
             ai_conditions = $4, ai_rationale = $5, ai_one_flag = $6,
             ai_one_strength = $7, ai_scored_at = now(), status = 'scored'
         WHERE id = $8`,
        [
          scored.score,
          JSON.stringify(scored.dimensionScores),
          scored.recommendation,
          JSON.stringify(scored.conditions),
          scored.rationale,
          scored.oneFlag,
          scored.oneStrength,
          applicationId,
        ]
      );
    } catch (scoringErr) {
      console.error(`Scoring failed for application ${applicationId}:`, scoringErr.message);
      await query(`UPDATE applications SET ai_error = $1 WHERE id = $2`, [scoringErr.message, applicationId]);
    }

    // The reported bug: no code path previously sent any internal
    // notification at all on submission — this was simply never built,
    // not a broken existing send. Owner notification is attempted first
    // (it's the one that actually closes the original bug), then the
    // applicant confirmation — both best-effort. The application row
    // already exists at this point, so neither send is allowed to turn a
    // successful submission into a reported failure: a saved application
    // is a successful application, full stop. A visitor who saw a false
    // "submission failed" here would resubmit and create a duplicate row
    // for information CHEW already has.
    try {
      await sendOwnerNewApplicationNotice({
        applicationId,
        fullName: String(fullName).trim(),
        email: String(email).trim(),
        phone: phone ? String(phone).trim() : null,
        answers,
        reviewUrl: `${process.env.SITE_URL}/admin-applications.html#app-${applicationId}`,
      });
    } catch (emailErr) {
      console.error(`OWNER_NOTIFICATION_FAILED application=${applicationId}:`, emailErr.message);
    }

    try {
      await sendStartingPositionConfirmationEmail({ to: email, name: fullName, answers });
    } catch (emailErr) {
      console.error(`APPLICANT_CONFIRMATION_FAILED application=${applicationId}:`, emailErr.message);
    }

    return res.status(200).json({ id: applicationId, status: 'received' });
  } catch (err) {
    console.error('submit-application error:', err.message);
    return res.status(500).json({ error: 'Unable to submit application.' });
  }
};
