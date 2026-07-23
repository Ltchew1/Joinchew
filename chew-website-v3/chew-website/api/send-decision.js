// /api/send-decision.js
//
// Sends the human-reviewed admissions decision to an applicant and marks
// the application decided. A human must choose the decision explicitly —
// this endpoint never sends the AI's raw recommendation automatically.
// Requires ADMIN_SECRET, DATABASE_URL, RESEND_API_KEY, FROM_EMAIL.
//
// POST /api/send-decision.js  { secret, id, decision, note }

const { query } = require('../lib/db');
const { sendDecisionEmail } = require('../lib/email');
const { createPortalInvitation } = require('../lib/clerk');
const { VALID_RECOMMENDATIONS } = require('../lib/scoring');

const PORTAL_DECISIONS = ['ACCEPT', 'ACCEPT_WITH_CONDITIONS'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ADMIN_SECRET) {
    return res.status(503).json({ error: 'Admin access is not configured yet.' });
  }

  const { secret, id, decision, note } = req.body || {};

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!id || !VALID_RECOMMENDATIONS.includes(decision)) {
    return res.status(400).json({ error: 'A valid application id and decision are required.' });
  }

  try {
    const result = await query(`SELECT full_name, email, access_token FROM applications WHERE id = $1`, [id]);
    const application = result.rows[0];
    if (!application) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    await sendDecisionEmail({
      to: application.email,
      name: application.full_name,
      decision,
      note: note ? String(note).slice(0, 2000) : '',
      selectProgramUrl: `${process.env.SITE_URL}/select-program.html?token=${encodeURIComponent(application.access_token)}`,
    });

    if (PORTAL_DECISIONS.includes(decision)) {
      try {
        await createPortalInvitation({ email: application.email, name: application.full_name });
      } catch (invitationErr) {
        // Don't fail the whole decision over a portal-invite hiccup — the
        // applicant still got their decision email, and an admin can
        // re-invite manually from Clerk's dashboard if needed.
        console.error('Portal invitation error:', invitationErr.message);
      }
    }

    await query(
      `UPDATE applications
       SET decision = $1, decision_note = $2, status = 'decided', decided_at = now()
       WHERE id = $3`,
      [decision, note || null, id]
    );

    return res.status(200).json({ id, status: 'decided' });
  } catch (err) {
    console.error('send-decision error:', err.message);
    return res.status(500).json({ error: 'Unable to send decision.' });
  }
};
