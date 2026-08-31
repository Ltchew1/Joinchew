// /api/purchase-summary.js
//
// Read-only lookup by purchase access token. Returns just enough real data
// to render the remainder-balance Deal Sheet on pay-remainder.html before
// payment — tier, the real remainder amount already set on this purchase
// row (see api/create-program-checkout-session.js, which sets it from
// lib/programs.js at purchase time), and whether it's already been paid.
// This never creates a Stripe session; api/create-remainder-checkout-session.js
// still owns that step and is unchanged.
//
// GET /api/purchase-summary?token=<program_purchases.access_token>

const { query } = require('../lib/db');
const { getDealSheetData } = require('../lib/agreementRegistry');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  try {
    const result = await query(
      `SELECT tier, remainder_amount_cents, remainder_paid_at, status
       FROM program_purchases WHERE access_token = $1`,
      [token]
    );
    const purchase = result.rows[0];
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

    let deal = null;
    try {
      deal = getDealSheetData(purchase.tier);
    } catch {
      deal = null;
    }

    return res.status(200).json({
      tier: purchase.tier,
      label: deal ? deal.label : purchase.tier,
      remainderAmountCents: purchase.remainder_amount_cents,
      alreadyPaid: !!purchase.remainder_paid_at,
      status: purchase.status,
      cancellation: deal ? deal.cancellation : null,
      refund: deal ? deal.refund : null,
      doesNotPromise: deal ? deal.doesNotPromise : null,
    });
  } catch (err) {
    console.error('purchase-summary error:', err.message);
    return res.status(500).json({ error: 'Unable to load purchase.' });
  }
};
