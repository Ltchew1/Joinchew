// /api/create-program-checkout-session.js
//
// Vercel serverless function. Creates the Stripe Checkout Session for an
// accepted applicant's chosen engagement and payment plan. Reached from
// sign-agreement.html immediately after a signature is recorded — requires
// a valid signatureId (see api/sign-agreement.js) tied to this application,
// tier, AND payment plan, so no checkout session can be created without a
// matching signed agreement for the exact terms being charged.
// select-program.html -> sign-agreement.html -> here, all reached via the
// link in the applicant's ACCEPT / ACCEPT_WITH_CONDITIONS decision email
// (see lib/email.js DECISION_CONTENT and api/send-decision.js).
//
// Two payment options, same total price either way (see lib/programs.js):
//   pay_in_full — one Checkout Session charges the full price today.
//   monthly     — one Checkout Session charges the initial payment today
//                 (with the resulting payment method saved for future
//                 off-session use); api/stripe-webhook.js then creates a
//                 Stripe Subscription Schedule for the remaining
//                 installments once that initial charge is confirmed.
//
// Requires: STRIPE_SECRET_KEY, DATABASE_URL, SITE_URL, and (membership
// only) STRIPE_PRICE_MEMBERSHIP_ENTRY / STRIPE_PRICE_MEMBERSHIP_RECURRING.
// One-time engagements are charged via inline price_data (the amount
// depends on which payment plan was chosen, not a single fixed Price
// object), the same pattern api/create-remainder-checkout-session.js
// already uses for its own computed amount.

const crypto = require('crypto');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { query } = require('../lib/db');
const { getProgram, isOneTimeTier } = require('../lib/programs');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, tier, signatureId } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing application token.' });
    if (!signatureId) return res.status(400).json({ error: 'Please sign the Client Services Agreement first.' });

    let program;
    try {
      program = getProgram(tier);
    } catch {
      return res.status(400).json({ error: 'Invalid program tier.' });
    }
    const oneTime = isOneTimeTier(tier);

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

    const signatureResult = await query(
      `SELECT id, payment_plan_type_at_signing, total_contract_amount_at_signing,
              initial_payment_amount_at_signing, installment_amount_at_signing, installment_count_at_signing
       FROM agreement_signatures WHERE id = $1 AND application_id = $2 AND tier = $3`,
      [signatureId, application.id, tier]
    );
    const signature = signatureResult.rows[0];
    if (!signature) {
      return res.status(403).json({ error: 'Please sign the Client Services Agreement first.' });
    }

    const paymentPlanType = signature.payment_plan_type_at_signing;
    if (oneTime && !['pay_in_full', 'monthly'].includes(paymentPlanType)) {
      return res.status(403).json({ error: 'Please sign the Client Services Agreement first.' });
    }

    // Term-drift guard: the client saw specific commercial terms (and a
    // specific payment plan) on the Deal Sheet at the moment they signed
    // (snapshotted onto the signature row — see api/sign-agreement.js).
    // If live pricing has since changed (a deploy to lib/programs.js
    // between signing and paying), checkout must not silently go ahead
    // against terms the client never actually reviewed.
    if (oneTime) {
      const currentInitial = paymentPlanType === 'pay_in_full' ? program.totalCents : program.monthly.initialCents;
      const currentInstallment = paymentPlanType === 'monthly' ? program.monthly.installmentCents : null;
      const currentCount = paymentPlanType === 'monthly' ? program.monthly.installmentCount : null;
      const termsDrifted = [
        [signature.total_contract_amount_at_signing, program.totalCents],
        [signature.initial_payment_amount_at_signing, currentInitial],
        [signature.installment_amount_at_signing, currentInstallment],
        [signature.installment_count_at_signing, currentCount],
      ].some(([snapshot, current]) => snapshot != null && snapshot !== current);

      if (termsDrifted) {
        return res.status(409).json({
          error: 'Program terms have changed since you signed the agreement. Please review and sign again before paying.',
          termsChanged: true,
        });
      }
    }

    const purchaseToken = crypto.randomUUID();
    const insertResult = await query(
      `INSERT INTO program_purchases (
         access_token, application_id, tier, client_name, client_email,
         entry_amount_cents, agreement_signature_id,
         payment_plan_type, total_contract_amount_cents, initial_payment_amount_cents,
         installment_amount_cents, installment_count
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        purchaseToken, application.id, tier, application.full_name, application.email,
        // entry_amount_cents stays populated (legacy NOT NULL column,
        // predates the payment-plan model) with whatever's actually
        // charged today, so it keeps meaning "amount charged at
        // checkout" for any older code/report that still reads it.
        oneTime ? signature.initial_payment_amount_at_signing : program.entryAmountCents,
        signatureId,
        oneTime ? paymentPlanType : null,
        oneTime ? signature.total_contract_amount_at_signing : null,
        oneTime ? signature.initial_payment_amount_at_signing : null,
        oneTime ? signature.installment_amount_at_signing : null,
        oneTime ? signature.installment_count_at_signing : null,
      ]
    );
    const purchaseId = insertResult.rows[0].id;

    const sessionConfig = {
      customer_email: application.email,
      success_url: `${process.env.SITE_URL}/booking-confirmed.html?program=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/select-program.html?token=${encodeURIComponent(token)}&cancelled=true`,
    };

    let session;
    if (tier === 'membership') {
      const entryPriceId = process.env[program.entryPriceEnv];
      const recurringPriceId = process.env[program.recurringPriceEnv];
      if (!entryPriceId) return res.status(503).json({ error: `${program.entryPriceEnv} is not configured yet.` });
      if (!recurringPriceId) return res.status(503).json({ error: `${program.recurringPriceEnv} is not configured yet.` });
      session = await stripe.checkout.sessions.create({
        ...sessionConfig,
        metadata: { purchase_id: String(purchaseId), tier, phase: 'entry' },
        mode: 'subscription',
        line_items: [
          { price: entryPriceId, quantity: 1 },
          { price: recurringPriceId, quantity: 1 },
        ],
        subscription_data: { trial_period_days: program.trialPeriodDays },
      });
    } else {
      const chargeCents = signature.initial_payment_amount_at_signing;
      const planLabel = paymentPlanType === 'pay_in_full' ? 'Pay in Full' : 'Initial Payment';
      session = await stripe.checkout.sessions.create({
        ...sessionConfig,
        metadata: { purchase_id: String(purchaseId), tier, phase: 'plan_payment', payment_plan_type: paymentPlanType },
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: chargeCents,
            product_data: { name: `${program.label} — ${planLabel}` },
          },
          quantity: 1,
        }],
        // Monthly Plan needs a reusable payment method on a real Customer
        // object to bill the remaining installments automatically later
        // (see api/stripe-webhook.js, which creates the Subscription
        // Schedule once this initial charge is confirmed). Pay in Full
        // never charges again, so it doesn't need this, but requesting it
        // unconditionally is harmless and keeps this branch simple.
        customer_creation: 'always',
        payment_intent_data: { setup_future_usage: 'off_session' },
      });
    }

    await query(`UPDATE program_purchases SET entry_stripe_session_id = $1 WHERE id = $2`, [session.id, purchaseId]);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-program-checkout-session error:', err.message);
    return res.status(500).json({ error: 'Unable to create checkout session.' });
  }
};
