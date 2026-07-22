// /api/create-program-checkout-session.js
//
// Vercel serverless function. Creates the entry-fee Stripe Checkout Session
// for an accepted applicant's chosen program tier. Reached from
// select-program.html, which an applicant only gets to via the link in
// their ACCEPT / ACCEPT_WITH_CONDITIONS decision email (see
// lib/email.js DECISION_CONTENT and api/send-decision.js).
//
// Requires: STRIPE_SECRET_KEY, DATABASE_URL, SITE_URL, and per-tier Stripe
// Price ids (see lib/programs.js) — STRIPE_PRICE_INFRASTRUCTURE_ENTRY,
// STRIPE_PRICE_EXECUTIVE_ENTRY, STRIPE_PRICE_MEMBERSHIP_ENTRY,
// STRIPE_PRICE_MEMBERSHIP_RECURRING.

const crypto = require('crypto');
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
    const { token, tier } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing application token.' });

    let program;
    try {
      program = getProgram(tier);
    } catch {
      return res.status(400).json({ error: 'Invalid program tier.' });
    }

    const appResult = await query(
      `SELECT id, full_name, email, decision FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) {
      return res.status(404).json({ error: 'Application not found.' });
    }
    if (!['ACCEPT', 'ACCEPT_WITH_CONDITIONS'].includes(application.decision)) {
      return res.status(403).json({ error: 'This application has not been accepted.' });
    }

    const entryPriceId = process.env[program.entryPriceEnv];
    if (!entryPriceId) {
      return res.status(503).json({ error: `${program.entryPriceEnv} is not configured yet.` });
    }

    const purchaseToken = crypto.randomUUID();
    const insertResult = await query(
      `INSERT INTO program_purchases (access_token, application_id, tier, client_name, client_email, entry_amount_cents, remainder_amount_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        purchaseToken,
        application.id,
        tier,
        application.full_name,
        application.email,
        program.entryAmountCents,
        program.hasRemainder ? program.remainderAmountCents : null,
      ]
    );
    const purchaseId = insertResult.rows[0].id;

    const sessionConfig = {
      customer_email: application.email,
      metadata: { purchase_id: String(purchaseId), tier, phase: 'entry' },
      success_url: `${process.env.SITE_URL}/booking-confirmed.html?program=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/select-program.html?token=${encodeURIComponent(token)}&cancelled=true`,
    };

    let session;
    if (tier === 'membership') {
      const recurringPriceId = process.env[program.recurringPriceEnv];
      if (!recurringPriceId) {
        return res.status(503).json({ error: `${program.recurringPriceEnv} is not configured yet.` });
      }
      session = await stripe.checkout.sessions.create({
        ...sessionConfig,
        mode: 'subscription',
        line_items: [
          { price: entryPriceId, quantity: 1 },
          { price: recurringPriceId, quantity: 1 },
        ],
        subscription_data: { trial_period_days: program.trialPeriodDays },
      });
    } else {
      session = await stripe.checkout.sessions.create({
        ...sessionConfig,
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price: entryPriceId, quantity: 1 }],
      });
    }

    await query(`UPDATE program_purchases SET entry_stripe_session_id = $1 WHERE id = $2`, [session.id, purchaseId]);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-program-checkout-session error:', err.message);
    return res.status(500).json({ error: 'Unable to create checkout session.' });
  }
};
