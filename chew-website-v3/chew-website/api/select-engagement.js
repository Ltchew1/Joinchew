// /api/select-engagement.js
//
// The actual enforcement point for "the client may buy only what CHEW
// approved" — never trusts a URL tier, hidden field, or client JS. Every
// check below is server-side and re-derived from the database on every
// call:
//   1. application token is valid and accepted
//   2. an active (status='sent') recommendation exists
//   3. the submitted tier equals that recommendation's primary_tier or
//      alternative_tier — anything else is a 403, not a redirect
//   4. no unsatisfied blocking condition exists on that recommendation
// On success, records engagement_selections (superseding any prior
// active selection for the SAME recommendation — a client changing their
// mind pre-signature is normal and allowed). This is the row
// api/sign-agreement.js and api/create-program-checkout-session.js will
// later re-verify against before ever creating a signature or a charge.
//
// POST /api/select-engagement { token, tier }

const { getPool } = require('../lib/db');
const { hasUnsatisfiedBlockingConditions, isTierApproved } = require('../lib/recommendations');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, tier } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing application token.' });
  if (!tier) return res.status(400).json({ error: 'Missing tier.' });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const appResult = await client.query(
      `SELECT id, decision FROM applications WHERE access_token = $1 FOR UPDATE`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found.' });
    }
    if (!['ACCEPT', 'ACCEPT_WITH_CONDITIONS'].includes(application.decision)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'This application has not been accepted.' });
    }

    const recResult = await client.query(
      `SELECT id, version, primary_tier, alternative_tier FROM engagement_recommendations
       WHERE application_id = $1 AND status = 'sent' FOR UPDATE`,
      [application.id]
    );
    const recommendation = recResult.rows[0];
    if (!recommendation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No active recommendation to select from.' });
    }

    if (!isTierApproved(recommendation, tier)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'That engagement was not approved for this application.' });
    }

    if (await hasUnsatisfiedBlockingConditions(recommendation.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'One or more conditions need to be satisfied before you can select an engagement.',
        code: 'BLOCKING_CONDITIONS_UNSATISFIED',
      });
    }

    await client.query(
      `UPDATE engagement_selections SET superseded_at = now()
       WHERE recommendation_id = $1 AND superseded_at IS NULL`,
      [recommendation.id]
    );

    const insertResult = await client.query(
      `INSERT INTO engagement_selections (application_id, recommendation_id, recommendation_version, selected_tier)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [application.id, recommendation.id, recommendation.version, tier]
    );

    await client.query('COMMIT');

    return res.status(200).json({ selectionId: insertResult.rows[0].id, tier, recommendationVersion: recommendation.version });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('select-engagement error:', err.message);
    return res.status(500).json({ error: 'Unable to record your selection.' });
  } finally {
    client.release();
  }
};
