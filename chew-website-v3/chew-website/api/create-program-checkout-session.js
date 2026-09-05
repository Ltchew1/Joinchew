// /api/create-program-checkout-session.js
//
// Vercel serverless function. Creates the Stripe Checkout Session for an
// accepted applicant's chosen engagement and payment plan. Reached from
// sign-agreement.html immediately after a signature is recorded — requires
// a valid signatureId (see api/sign-agreement.js) tied to this application,
// so no checkout session can be created without a matching signed
// agreement for the exact terms being charged. recommendation.html ->
// sign-agreement.html -> here, all reached via the applicant's token from
// their "Your CHEW Recommendation Is Ready" email
// (see lib/email.js sendRecommendationReadyEmail and api/save-recommendation.js).
//
// Deliberately does NOT accept tier from the client — read from the
// signature row itself (server truth set by api/sign-agreement.js), same
// doctrine that file documents. This is the checkout-side half of the
// CHEW Recommendation Engine's approved-option gate (directive: "Checkout
// must verify: signed agreement + recommendation id/version + approved
// tier + client selection + payment-plan selection all agree. Any
// mismatch: BLOCK PAYMENT.") — re-verified independently here rather than
// trusted from the signing step, in case anything changed in between.
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
const { getRecommendationById, isTierApproved } = require('../lib/recommendations');
const { isGraduate } = require('../lib/graduateStatus');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, signatureId } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing application token.' });
    if (!signatureId) return res.status(400).json({ error: 'Please sign the Client Services Agreement first.' });

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
      `SELECT id, tier, payment_plan_type_at_signing, total_contract_amount_at_signing,
              initial_payment_amount_at_signing, installment_amount_at_signing, installment_count_at_signing,
              recommendation_id, recommendation_version
       FROM agreement_signatures WHERE id = $1 AND application_id = $2`,
      [signatureId, application.id]
    );
    const signature = signatureResult.rows[0];
    if (!signature) {
      return res.status(403).json({ error: 'Please sign the Client Services Agreement first.' });
    }

    // tier comes from the signature row (server truth set by
    // api/sign-agreement.js), never from the client — see file header.
    const tier = signature.tier;

    let program;
    try {
      program = getProgram(tier);
    } catch {
      return res.status(400).json({ error: 'Invalid program tier.' });
    }

    // Membership is never a first-time engagement. A membership-tier
    // signature can now legitimately exist (see api/select-membership.js,
    // gated on graduate status there), so this re-checks the SAME
    // graduate fact independently here rather than trusting that the
    // signature step's gate is still true — the exact defense-in-depth
    // doctrine every other gate in this file already follows. Computed
    // once and reused below for the fee-waiver decision too (see the
    // membership checkout branch) — the waiver must never trust gate
    // ordering within this function, only a fresh isGraduate() result.
    let clientIsGraduate = false;
    if (tier === 'membership') {
      clientIsGraduate = await isGraduate(application.id);
      if (!clientIsGraduate) {
        return res.status(403).json({ error: 'Membership is available to CHEW graduates after their engagement completes, not as a first-time engagement.' });
      }
    }

    const oneTime = isOneTimeTier(tier);

    const paymentPlanType = signature.payment_plan_type_at_signing;
    if (oneTime && !['pay_in_full', 'monthly'].includes(paymentPlanType)) {
      return res.status(403).json({ error: 'Please sign the Client Services Agreement first.' });
    }

    // Checkout gate: signed agreement + recommendation id/version +
    // approved tier + client selection + payment-plan selection must all
    // still agree right now — re-verified independently here rather than
    // assumed still true from signing time. Any mismatch blocks payment.
    if (oneTime) {
      if (!signature.recommendation_id) {
        return res.status(403).json({ error: 'This signature is not bound to an active CHEW recommendation.' });
      }
      const recommendation = await getRecommendationById(signature.recommendation_id);
      if (!recommendation || recommendation.status !== 'sent') {
        return res.status(409).json({
          error: 'CHEW updated your recommendation. Review the latest recommendation before continuing.',
          code: 'RECOMMENDATION_UPDATED',
        });
      }
      if (!isTierApproved(recommendation, tier)) {
        return res.status(403).json({ error: 'That engagement is no longer approved for this application.' });
      }

      const selectionResult = await query(
        `SELECT recommendation_id, selected_tier, selected_payment_plan, superseded_at
         FROM engagement_selections WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [application.id]
      );
      const selection = selectionResult.rows[0];
      const selectionAgrees = selection
        && !selection.superseded_at
        && selection.recommendation_id === signature.recommendation_id
        && selection.selected_tier === tier
        && selection.selected_payment_plan === paymentPlanType;
      if (!selectionAgrees) {
        return res.status(403).json({ error: 'Your selection no longer matches your signed agreement. Please review your recommendation again.' });
      }
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

    // A graduate has no active recommendation to return to on cancel —
    // recommendation.html would just error for them. Route back to their
    // own engagement-status page instead (my-engagement.html), which is
    // also where the Membership offer itself lives.
    const cancelUrl = tier === 'membership'
      ? `${process.env.SITE_URL}/my-engagement.html?token=${encodeURIComponent(token)}&cancelled=true`
      : `${process.env.SITE_URL}/recommendation.html?token=${encodeURIComponent(token)}&cancelled=true`;

    const sessionConfig = {
      customer_email: application.email,
      success_url: `${process.env.SITE_URL}/booking-confirmed.html?program=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
    };

    let session;
    if (tier === 'membership') {
      const recurringPriceId = process.env[program.recurringPriceEnv];
      if (!recurringPriceId) return res.status(503).json({ error: `${program.recurringPriceEnv} is not configured yet.` });

      // The locked doctrine (Pre-Portal Master Specification) makes
      // graduate status BOTH the access gate above AND the fee-waiver
      // determination — so this re-checks clientIsGraduate directly
      // rather than trusting that reaching this line already implies it.
      // A future change to the gate above (or a second entry path into
      // this branch) must not be able to silently waive the fee for a
      // non-graduate merely by skipping the earlier check — this line
      // enforces the invariant on its own.
      const waiveEntryFee = clientIsGraduate && program.entryFeeWaivedForGraduates;
      const lineItems = [{ price: recurringPriceId, quantity: 1 }];
      if (!waiveEntryFee) {
        const entryPriceId = process.env[program.entryPriceEnv];
        if (!entryPriceId) return res.status(503).json({ error: `${program.entryPriceEnv} is not configured yet.` });
        lineItems.unshift({ price: entryPriceId, quantity: 1 });
      }

      session = await stripe.checkout.sessions.create({
        ...sessionConfig,
        metadata: { purchase_id: String(purchaseId), tier, phase: 'entry', entry_fee_waived: String(waiveEntryFee) },
        mode: 'subscription',
        line_items: lineItems,
        subscription_data: { trial_period_days: program.trialPeriodDays },
      });
    } else {
      const chargeCents = signature.initial_payment_amount_at_signing;
      const planLabel = paymentPlanType === 'pay_in_full' ? 'Pay in Full' : 'Initial Payment';
      const isMonthly = paymentPlanType === 'monthly';

      // Monthly Plan requires a payment method Stripe can charge again
      // automatically, off-session, months later (see api/stripe-webhook.js,
      // which creates a Subscription Schedule off this saved method once the
      // initial charge confirms) — restricted to card, the only method type
      // here that reliably supports setup_future_usage: 'off_session'
      // reuse. Klarna/Afterpay are approved CHEW payment methods generally
      // (see api/create-remainder-checkout-session.js) but are BNPL
      // products, not reusable off-session payment instruments, so they are
      // never offered for a Monthly Plan. Pay in Full never charges again,
      // so it keeps the full approved one-time method set.
      session = await stripe.checkout.sessions.create({
        ...sessionConfig,
        metadata: { purchase_id: String(purchaseId), tier, phase: 'plan_payment', payment_plan_type: paymentPlanType },
        mode: 'payment',
        payment_method_types: isMonthly ? ['card'] : ['card', 'klarna', 'afterpay_clearpay'],
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: chargeCents,
            product_data: { name: `${program.label} — ${planLabel}` },
          },
          quantity: 1,
        }],
        ...(isMonthly ? {
          customer_creation: 'always',
          payment_intent_data: { setup_future_usage: 'off_session' },
        } : {}),
      });
    }

    await query(`UPDATE program_purchases SET entry_stripe_session_id = $1 WHERE id = $2`, [session.id, purchaseId]);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-program-checkout-session error:', err.message);
    return res.status(500).json({ error: 'Unable to create checkout session.' });
  }
};
