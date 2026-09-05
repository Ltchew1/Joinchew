// /api/select-payment-plan.js
//
// Second half of the pre-signature purchase decision (directive §15):
// choosing an engagement (api/select-engagement.js) and choosing HOW to
// pay for it are separately tracked facts, not one combined step. Updates
// the client's existing active engagement_selections row rather than
// creating a new one — this is a refinement of the same selection, not a
// new decision.
//
// Detects the stale-recommendation race explicitly (directive §12): if
// CHEW sent a newer recommendation version after this selection was made
// but before the client got here, the client's most recent selection
// still points at the now-superseded recommendation. Rather than
// silently honoring it, this returns 409 RECOMMENDATION_UPDATED so the
// client is sent back to review the current recommendation first.
//
// POST /api/select-payment-plan { token, paymentPlan }

const { query } = require('../lib/db');
const { getActiveSentRecommendation } = require('../lib/recommendations');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, paymentPlan } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing application token.' });
  if (!['pay_in_full', 'monthly'].includes(paymentPlan)) {
    return res.status(400).json({ error: 'Please choose Pay in Full or the Monthly Plan.' });
  }

  try {
    const appResult = await query(`SELECT id FROM applications WHERE access_token = $1`, [token]);
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const latestSelectionResult = await query(
      `SELECT id, recommendation_id, superseded_at FROM engagement_selections
       WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [application.id]
    );
    const latestSelection = latestSelectionResult.rows[0];
    if (!latestSelection) {
      return res.status(400).json({ error: 'Please choose your engagement first.' });
    }

    const activeRecommendation = await getActiveSentRecommendation(application.id);
    if (!activeRecommendation || latestSelection.recommendation_id !== activeRecommendation.id || latestSelection.superseded_at) {
      return res.status(409).json({
        error: 'CHEW updated your recommendation. Review the latest recommendation before continuing.',
        code: 'RECOMMENDATION_UPDATED',
      });
    }

    await query(
      `UPDATE engagement_selections SET selected_payment_plan = $1, payment_plan_selected_at = now() WHERE id = $2`,
      [paymentPlan, latestSelection.id]
    );

    return res.status(200).json({ selectionId: latestSelection.id, paymentPlan });
  } catch (err) {
    console.error('select-payment-plan error:', err.message);
    return res.status(500).json({ error: 'Unable to record your payment choice.' });
  }
};
