// /api/my-engagement-status.js
//
// Backs my-engagement.html — the client-facing status/progress view and
// (once eligible) honest Membership offer, per the Pre-Portal Master
// Specification. Deliberately token-authed via applications.access_token,
// NOT program_purchases.access_token (see api/purchase-status.js): the
// application token is the one the client already durably holds, emailed
// to them at "Your CHEW Recommendation Is Ready" and reused across
// recommendation.html/sign-agreement.html/select-membership.html. Under
// the current payment-plan model, no email ever hands a client their
// purchase-level token directly (only the legacy entry+remainder model's
// pay-remainder link does) — so this page cannot assume one.
//
// Reports on the MOST RECENT purchase (same "latest wins" convention
// api/admin-applications.js already uses), composed via the shared
// lib/engagementStatus.js helper so this never re-derives the
// session/document-review counts or lifecycle rule a second time.
// membershipEligible is independent of which purchase is "latest" — it is
// the same any-engagement-ever graduate fact used everywhere else, so the
// Membership offer still appears for a graduate whose latest purchase is
// their original (non-membership) engagement.
//
// GET /api/my-engagement-status?token=<applications.access_token>

const { query } = require('../lib/db');
const { composePurchaseStatus } = require('../lib/engagementStatus');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  try {
    const appResult = await query(
      `SELECT id, full_name FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const purchaseResult = await query(
      `SELECT id, application_id, tier, status,
              payment_plan_type, payment_plan_status, total_contract_amount_cents,
              installment_amount_cents, installment_count, installments_paid,
              initial_payment_paid_at, paid_in_full_at,
              service_completed_at, continuity_ends_at, membership_status
       FROM program_purchases WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [application.id]
    );
    const purchase = purchaseResult.rows[0];

    if (!purchase) {
      // No purchase yet -- nothing to show here. This page is reached
      // from the Membership cancel_url and (eventually) a post-payment
      // confirmation link; a client with no purchase at all has landed
      // here early or by a stale link, not a state this page renders.
      return res.status(404).json({ error: 'No active engagement found for this application yet.' });
    }

    const status = await composePurchaseStatus(purchase);
    return res.status(200).json({
      fullName: application.full_name,
      ...status,
      membershipStatus: purchase.tier === 'membership' ? purchase.membership_status : null,
      isMembership: purchase.tier === 'membership',
    });
  } catch (err) {
    console.error('my-engagement-status error:', err.message);
    return res.status(500).json({ error: 'Unable to load engagement status.' });
  }
};
