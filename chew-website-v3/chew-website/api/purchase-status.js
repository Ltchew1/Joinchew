// /api/purchase-status.js
//
// The "current entitlement" read composition specified in the Pre-Portal
// Master Specification: one call resolving everything a client-facing
// status view (or, eventually, the portal's read layer) needs about a
// single paid engagement — scope, progress, completion, Continuity, and
// Membership eligibility — instead of re-deriving the
// recommendation/selection/signature join chain in five different
// places. Read-only; never mutates state.
//
// Distinct from api/purchase-summary.js, which is scoped narrowly to the
// remainder-balance Deal Sheet on pay-remainder.html and predates this
// endpoint — that one is unchanged and still owns its own purpose.
//
// "Membership eligible" (the graduate determination) is derived, not
// stored: EXISTS(any program_purchases row for this application with
// service_completed_at set), per the locked decision that graduate
// status is permanent and earned once, not tied to a specific engagement
// or a specific window.
//
// GET /api/purchase-status?token=<program_purchases.access_token>

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
    const result = await query(
      `SELECT id, application_id, tier, status,
              payment_plan_type, payment_plan_status, total_contract_amount_cents,
              installment_amount_cents, installment_count, installments_paid,
              initial_payment_paid_at, paid_in_full_at,
              service_completed_at, continuity_ends_at
       FROM program_purchases WHERE access_token = $1`,
      [token]
    );
    const purchase = result.rows[0];
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

    const status = await composePurchaseStatus(purchase);
    // focusAreas resolved via the recommendation chain when a client-facing
    // view needs it; not duplicated here to avoid a second source of truth
    // for scope content.
    return res.status(200).json({ ...status, focusAreas: null });
  } catch (err) {
    console.error('purchase-status error:', err.message);
    return res.status(500).json({ error: 'Unable to load purchase status.' });
  }
};
