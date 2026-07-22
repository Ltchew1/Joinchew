// /api/create-remainder-checkout-session.js
//
// Creates the remainder-balance Stripe Checkout Session for Infrastructure/
// Executive tier purchases, once the entry fee has been paid. Offers card,
// Klarna, and Afterpay/Clearpay together — Stripe's hosted Checkout page
// lets the client choose. Whichever they pick, CHEW is paid the full
// remainder amount immediately; Klarna/Afterpay handle underwriting and
// collection from the client on their own terms. Reached from
// pay-remainder.html, which is linked from the entry-fee confirmation email.
//
// The remainder amount (full program fee minus the entry fee already paid —
// e.g. $1,997 - $297 = $1,700) is charged via Stripe's inline price_data
// rather than a pre-created Price id, since it's a discounted balance with
// no separate Stripe Price object. The amount is read from the
// program_purchases row set at purchase time (lib/programs.js).
//
// A fresh Checkout Session is created on each visit (Stripe Checkout
// Sessions expire after 24 hours) rather than emailing a static payment
// link, since the client may not pay the remainder right away.
//
// Requires: STRIPE_SECRET_KEY, DATABASE_URL, SITE_URL.
//
// Klarna and Afterpay/Clearpay must also be enabled for the Stripe account
// (Dashboard → Settings → Payment methods) or Stripe will reject the session.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { query } = require('../lib/db');
const { getProgram } = require('../lib/programs');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing purchase token.' });

    const purchaseResult = await query(
      `SELECT id, tier, client_email, status, remainder_amount_cents, remainder_paid_at
       FROM program_purchases WHERE access_token = $1`,
      [token]
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found.' });
    }

    const program = getProgram(purchase.tier);
    if (!program.hasRemainder) {
      return res.status(400).json({ error: 'This program has no remainder payment.' });
    }
    if (purchase.remainder_paid_at) {
      return res.status(409).json({ error: 'The remainder balance has already been paid.' });
    }
    if (purchase.status !== 'pending_remainder') {
      return res.status(409).json({ error: 'Entry fee must be paid before the remainder balance.' });
    }

    if (!purchase.remainder_amount_cents) {
      return res.status(500).json({ error: 'Remainder amount is missing for this purchase.' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'klarna', 'afterpay_clearpay'],
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: purchase.remainder_amount_cents,
          product_data: { name: `${program.label} — Remaining Balance` },
        },
        quantity: 1,
      }],
      customer_email: purchase.client_email,
      metadata: { purchase_id: String(purchase.id), tier: purchase.tier, phase: 'remainder' },
      success_url: `${process.env.SITE_URL}/booking-confirmed.html?program=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/pay-remainder.html?token=${encodeURIComponent(token)}&cancelled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-remainder-checkout-session error:', err.message);
    return res.status(500).json({ error: 'Unable to create checkout session.' });
  }
};
