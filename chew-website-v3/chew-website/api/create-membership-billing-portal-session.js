// /api/create-membership-billing-portal-session.js
//
// Membership's "cancel anytime" self-service mechanism — reuses the exact
// stripe.billingPortal.sessions.create() call api/send-membership-reminders.js
// already makes for its reminder email, now reachable on demand from
// my-engagement.html instead of only arriving passively in an email a week
// before the first real charge. Stripe's Billing Portal has no separate
// pause option, only cancel (see that file's own comment) — that's the
// entire self-service surface CHEW's commercial terms promise, so this
// doesn't need to build anything beyond a session link.
//
// Deliberately does NOT compute or return any subscription state itself —
// my-engagement.html never calculates Membership status; it only ever
// displays what api/my-engagement-status.js already resolved, and calls
// this endpoint to get a redirect URL when the client clicks "Manage
// Membership." That's the same read/write separation this whole codebase
// already follows elsewhere (a status GET, a distinct action POST).
//
// Requires: STRIPE_SECRET_KEY, DATABASE_URL, SITE_URL
//
// POST /api/create-membership-billing-portal-session { token }
// token = applications.access_token (the token the client durably holds —
// same as api/my-engagement-status.js, not a purchase-level token).

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { query } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing application token.' });

    const appResult = await query(`SELECT id FROM applications WHERE access_token = $1`, [token]);
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const purchaseResult = await query(
      `SELECT stripe_customer_id FROM program_purchases
       WHERE application_id = $1 AND tier = 'membership' AND stripe_customer_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [application.id]
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) {
      return res.status(404).json({ error: 'No active Membership found for this application.' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: purchase.stripe_customer_id,
      return_url: `${process.env.SITE_URL}/my-engagement.html?token=${encodeURIComponent(token)}`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('create-membership-billing-portal-session error:', err.message);
    return res.status(500).json({ error: 'Unable to open billing management.' });
  }
};
