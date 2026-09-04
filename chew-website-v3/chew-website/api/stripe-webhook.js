// /api/stripe-webhook.js
//
// Stripe calls this endpoint directly (not the browser) when a payment event
// happens. This is what makes booking actually "automated" — without this,
// CHEW's database never learns that a payment succeeded.
//
// SETUP REQUIRED IN STRIPE DASHBOARD:
//   1. Go to Developers → Webhooks → Add endpoint
//   2. Endpoint URL: https://www.joinchew.com/api/stripe-webhook
//   3. Select events: checkout.session.completed, customer.subscription.updated,
//      customer.subscription.deleted (the latter two keep membership status in
//      sync — cancel is client self-service via the Billing Portal; pause is
//      not a Billing Portal feature, so it only happens if CHEW sets
//      pause_collection via the API/dashboard directly), invoice.payment_succeeded,
//      invoice.payment_failed (Monthly Plan program-purchase installments,
//      billed off a Stripe Subscription Schedule — see the phase ===
//      'plan_payment' handling below. Never fires for Membership, which
//      bills off a plain Subscription with its own price/webhook path.)
//   4. Copy the "Signing secret" (starts with whsec_...) into Vercel as
//      STRIPE_WEBHOOK_SECRET — never in this file.
//
// Requires: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, DATABASE_URL,
// RESEND_API_KEY, FROM_EMAIL, SITE_URL

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { query, getPool } = require('../lib/db');
const {
  sendConfirmationEmail,
  sendProgramEntryConfirmationEmail,
  sendMembershipWelcomeEmail,
  sendRemainderConfirmationEmail,
  sendAdminBonusSessionNotice,
  sendOwnerEnrollmentNotice,
  sendPlanPaymentReceivedEmail,
  sendPlanPaymentFailedEmail,
  sendPlanPaidInFullEmail,
  sendOwnerPlanPaymentFailedNotice,
} = require('../lib/email');
const { PROGRAMS } = require('../lib/programs');

// Payment state (entry_paid_at / remainder_paid_at) and notification state
// are separate facts, claimed separately -- see db/schema.sql for why.
// Four independent notification "kinds" share this one claim function,
// each backed by its own purchase-level timestamp column: entry-phase
// (customer_enrollment_notified_at / owner_enrollment_notified_at) and
// remainder-phase (remainder_customer_notified_at / remainder_owner_notified_at).
// Purchase-level (not per-payment-event) is deliberate: audited first --
// api/create-remainder-checkout-session.js refuses to open a second
// session once a purchase's remainder is paid or has left
// 'pending_remainder', so remainder is architecturally a single final
// balance payment per purchase, never an installment series. A
// per-payment-event ledger would be unmatched complexity for a data model
// that only ever has one remainder event to notify about.
//
// This claims ONE kind for one purchase: locks the row, checks the
// specific notified_at column under that lock, sends only if still null,
// and only marks it sent after the send actually succeeds. Two concurrent
// webhook deliveries for the same purchase serialize on the row lock --
// the loser blocks until the winner's transaction commits (or rolls back,
// if the send threw), then re-checks the now-current column itself rather
// than trusting a value read before the lock. A send failure rolls back
// and leaves the column null, so it's always safe to retry -- never a
// permanently stuck "claimed but never sent" state.
// Also covers the new payment-plan model's purchase-level notifications:
// initial payment (the first charge for a one-time engagement, whichever
// plan), paid-in-full (fires once, from either plan), and payment-failed
// (an installment declined — see NOTIFICATION_COLUMNS below and the
// invoice.payment_succeeded/invoice.payment_failed handlers). Per-
// installment notices are a separate concern (claimAndSendInstallmentNotification)
// since program_purchase_installments is a genuine one-row-per-event
// ledger, unlike remainder.
const NOTIFICATION_COLUMNS = {
  entryCustomer: 'customer_enrollment_notified_at',
  entryOwner: 'owner_enrollment_notified_at',
  remainderCustomer: 'remainder_customer_notified_at',
  remainderOwner: 'remainder_owner_notified_at',
  initialCustomer: 'initial_payment_customer_notified_at',
  initialOwner: 'initial_payment_owner_notified_at',
  paidInFullCustomer: 'paid_in_full_customer_notified_at',
  paidInFullOwner: 'paid_in_full_owner_notified_at',
  failedCustomer: 'payment_failed_customer_notified_at',
  failedOwner: 'payment_failed_owner_notified_at',
};

async function claimAndSendNotification(purchaseId, kind, sendFn) {
  const column = NOTIFICATION_COLUMNS[kind];
  if (!column) throw new Error(`Unknown notification kind: ${kind}`);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT customer_enrollment_notified_at, owner_enrollment_notified_at,
              remainder_customer_notified_at, remainder_owner_notified_at,
              initial_payment_customer_notified_at, initial_payment_owner_notified_at,
              paid_in_full_customer_notified_at, paid_in_full_owner_notified_at,
              payment_failed_customer_notified_at, payment_failed_owner_notified_at
       FROM program_purchases WHERE id = $1 FOR UPDATE`,
      [purchaseId]
    );
    const row = result.rows[0];
    if (!row || row[column]) {
      await client.query('ROLLBACK');
      return false;
    }

    await sendFn();

    await client.query(`UPDATE program_purchases SET ${column} = now() WHERE id = $1`, [purchaseId]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Per-installment counterpart of claimAndSendNotification, scoped to
// program_purchase_installments — a genuine one-row-per-payment-event
// ledger (unlike the purchase-level columns above), so each installment's
// customer receipt is claimed independently on its own row.
async function claimAndSendInstallmentNotification(installmentId, sendFn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT customer_notified_at FROM program_purchase_installments WHERE id = $1 FOR UPDATE`,
      [installmentId]
    );
    const row = result.rows[0];
    if (!row || row.customer_notified_at) {
      await client.query('ROLLBACK');
      return false;
    }

    await sendFn();

    await client.query(`UPDATE program_purchase_installments SET customer_notified_at = now() WHERE id = $1`, [installmentId]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Idempotent installment recording — INSERT ... ON CONFLICT DO NOTHING
// against the UNIQUE stripe_invoice_id constraint, same role
// entry_stripe_session_id plays for one-time payments. Stripe redelivers
// invoice.payment_succeeded/failed on anything but a fast 2xx; this makes
// a redelivery a no-op read instead of a duplicate charge record.
async function ensureInstallmentRecorded(purchaseId, invoiceId, amountCents, status) {
  const insertResult = await query(
    `INSERT INTO program_purchase_installments (purchase_id, stripe_invoice_id, amount_cents, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stripe_invoice_id) DO NOTHING
     RETURNING id`,
    [purchaseId, invoiceId, amountCents, status]
  );
  if (insertResult.rows[0]) {
    return { id: insertResult.rows[0].id, isNew: true };
  }
  const existing = await query(
    `SELECT id FROM program_purchase_installments WHERE stripe_invoice_id = $1`,
    [invoiceId]
  );
  return { id: existing.rows[0].id, isNew: false };
}

// Vercel needs the raw request body (unparsed) to verify the Stripe signature.
module.exports.config = {
  api: { bodyParser: false },
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;
    const purchaseId = session.metadata?.purchase_id;
    const email = session.customer_email || session.customer_details?.email;

    try {
      if (purchaseId) {
        // Came from the post-acceptance program-purchase flow (entry fee or
        // remainder balance — see api/create-program-checkout-session.js
        // and api/create-remainder-checkout-session.js).
        const phase = session.metadata?.phase;
        const purchaseResult = await query(
          `SELECT id, access_token, tier, client_name, client_email, remainder_amount_cents,
                  application_id, agreement_signature_id, entry_paid_at, remainder_paid_at,
                  membership_first_charge_at, remainder_payment_method, bonus_session_earned,
                  payment_plan_type, installment_amount_cents,
                  installment_count, installments_paid, total_contract_amount_cents,
                  initial_payment_paid_at
           FROM program_purchases WHERE id = $1`,
          [purchaseId]
        );
        const purchase = purchaseResult.rows[0];

        // Stripe retries checkout.session.completed on anything but a fast
        // 2xx, and can occasionally redeliver an already-acknowledged event
        // regardless. entry_paid_at / remainder_paid_at are the existing
        // durable markers for PAYMENT state; deliberately NOT used to gate
        // notification sends any more (see claimAndSendNotification above)
        // — a payment can confirm successfully on delivery #1 while an
        // email provider call fails right after, and delivery #2 must
        // still retry exactly that missing email, not skip the branch
        // entirely because the payment was already marked paid.
        if (!purchase) {
          console.error('Webhook: program_purchases row not found for id', purchaseId);
        } else if (phase === 'entry') {
          // Step 2: mark payment confirmed idempotently. WHERE ...IS NULL
          // makes this atomic on its own — a lost race here just means a
          // concurrent delivery already confirmed it (or is about to);
          // either way this delivery still proceeds to check/attempt
          // notifications below using current DB state.
          let firstChargeAt = purchase.membership_first_charge_at ? new Date(purchase.membership_first_charge_at) : null;

          if (!purchase.entry_paid_at) {
            if (purchase.tier === 'membership') {
              const subscription = await stripe.subscriptions.retrieve(session.subscription);
              firstChargeAt = new Date(subscription.trial_end * 1000);
              await query(
                `UPDATE program_purchases
                 SET entry_paid_at = now(), status = 'complete',
                     stripe_customer_id = $1, stripe_subscription_id = $2,
                     membership_first_charge_at = $3, membership_status = 'trialing'
                 WHERE id = $4 AND entry_paid_at IS NULL`,
                [session.customer, session.subscription, firstChargeAt.toISOString(), purchase.id]
              );
            } else {
              await query(
                `UPDATE program_purchases SET entry_paid_at = now(), status = 'pending_remainder'
                 WHERE id = $1 AND entry_paid_at IS NULL`,
                [purchase.id]
              );
            }
          }

          // Steps 3-8: attempt only whichever notification is still
          // missing, each independently claimed and persisted the moment
          // it actually sends. One failing never blocks or un-sends the
          // other, and never rolls back the payment confirmation above.
          const sendCustomerNotice = purchase.tier === 'membership'
            ? () => sendMembershipWelcomeEmail({
                to: purchase.client_email,
                name: purchase.client_name,
                amountPaidCents: session.amount_total,
                agreementSigned: Boolean(purchase.agreement_signature_id),
                firstChargeDate: firstChargeAt,
              })
            : () => sendProgramEntryConfirmationEmail({
                to: purchase.client_email,
                name: purchase.client_name,
                tier: purchase.tier,
                amountPaidCents: session.amount_total,
                remainderAmountCents: purchase.remainder_amount_cents,
                agreementSigned: Boolean(purchase.agreement_signature_id),
                payRemainderUrl: `${process.env.SITE_URL}/pay-remainder.html?token=${encodeURIComponent(purchase.access_token)}`,
              });

          try {
            const sent = await claimAndSendNotification(purchase.id, 'entryCustomer', sendCustomerNotice);
            if (!sent) console.log(`Webhook: customer notification for purchase ${purchase.id} already sent — skipping.`);
          } catch (emailErr) {
            console.error(`CUSTOMER_ENROLLMENT_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
          }

          const paymentStatus = purchase.tier === 'membership' ? 'Entry fee paid — membership trialing' : 'Entry fee paid — remainder pending';
          const nextAction = purchase.tier === 'membership'
            ? 'Membership is active (trialing). No further payment action needed until the first monthly charge.'
            : 'Remainder balance still owed. Client has a pay-remainder link for the rest.';

          try {
            const sent = await claimAndSendNotification(purchase.id, 'entryOwner', () => sendOwnerEnrollmentNotice({
              applicationId: purchase.application_id,
              purchaseId: purchase.id,
              fullName: purchase.client_name,
              tier: purchase.tier,
              amountPaidCents: session.amount_total,
              paymentStatus,
              signatureId: purchase.agreement_signature_id,
              nextAction,
            }));
            if (!sent) console.log(`Webhook: owner notification for purchase ${purchase.id} already sent — skipping.`);
          } catch (emailErr) {
            console.error(`OWNER_ENROLLMENT_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
          }
        } else if (phase === 'remainder') {
          // Step 2: mark payment confirmed idempotently, decoupled from
          // notification sends below — same doctrine as entry-phase.
          // methodType/bonusEarned only need deriving via Stripe API calls
          // the FIRST time this purchase confirms; on a retry (payment
          // already confirmed by a prior delivery) that outcome is already
          // persisted, so re-read it from the row instead of re-calling
          // Stripe and risking an inconsistent bonusEarned across deliveries.
          let bonusEarned = Boolean(purchase.bonus_session_earned);

          if (!purchase.remainder_paid_at) {
            let methodType = 'card';
            try {
              const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
              if (paymentIntent.payment_method) {
                const paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
                methodType = paymentMethod.type;
              }
            } catch (pmErr) {
              console.error('Could not determine remainder payment method:', pmErr.message);
            }
            bonusEarned = methodType === 'card';

            await query(
              `UPDATE program_purchases
               SET remainder_paid_at = now(), remainder_payment_method = $1,
                   bonus_session_earned = $2, status = 'complete'
               WHERE id = $3 AND remainder_paid_at IS NULL`,
              [methodType, bonusEarned, purchase.id]
            );
          }

          // Steps 3-8: attempt only whichever notification is still
          // missing. Customer confirmation always applies; the owner
          // bonus-session notice only applies when bonusEarned is true —
          // if it's false, that claim is simply never attempted (there
          // will never be anything to notify), not a "failure."
          try {
            const sent = await claimAndSendNotification(purchase.id, 'remainderCustomer', () => sendRemainderConfirmationEmail({
              to: purchase.client_email,
              name: purchase.client_name,
              tier: purchase.tier,
              bonusEarned,
            }));
            if (!sent) console.log(`Webhook: remainder customer notification for purchase ${purchase.id} already sent — skipping.`);
          } catch (emailErr) {
            console.error(`CUSTOMER_ENROLLMENT_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
          }

          if (bonusEarned) {
            try {
              const sent = await claimAndSendNotification(purchase.id, 'remainderOwner', () => sendAdminBonusSessionNotice({
                purchaseId: purchase.id,
                name: purchase.client_name,
                email: purchase.client_email,
                tier: purchase.tier,
              }));
              if (!sent) console.log(`Webhook: remainder owner notification for purchase ${purchase.id} already sent — skipping.`);
            } catch (emailErr) {
              console.error(`OWNER_ENROLLMENT_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
            }
          }
        } else if (phase === 'plan_payment') {
          // First payment for a one-time engagement (Focused Builder /
          // Infrastructure / Advanced Infrastructure / Executive) under
          // the new pay-in-full-or-monthly model — see
          // api/create-program-checkout-session.js and lib/programs.js.
          // Step 2: mark it confirmed idempotently, same WHERE ...IS NULL
          // pattern as entry/remainder above, decoupled from notification
          // sends below.
          if (!purchase.initial_payment_paid_at) {
            if (purchase.payment_plan_type === 'monthly') {
              // The Checkout Session (mode: 'payment', setup_future_usage:
              // 'off_session') just saved a reusable payment method on a
              // real Stripe Customer. Bill the REMAINING installments only
              // via a Subscription Schedule — never the initial payment
              // again — starting ~1 month out, ending itself automatically
              // after installment_count charges. No interest/financing
              // charge is ever added (see lib/programs.js / locked doctrine).
              const remainingCount = purchase.installment_count;
              let scheduleId = null;
              let subscriptionId = null;
              let nextPaymentDueAt = null;

              if (remainingCount > 0) {
                const startDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
                const schedule = await stripe.subscriptionSchedules.create({
                  customer: session.customer,
                  start_date: startDate,
                  end_behavior: 'cancel',
                  phases: [{
                    items: [{
                      price_data: {
                        currency: 'usd',
                        unit_amount: purchase.installment_amount_cents,
                        recurring: { interval: 'month' },
                        product_data: { name: `${PROGRAMS[purchase.tier].label} — Monthly Plan Installment` },
                      },
                      quantity: 1,
                    }],
                    iterations: remainingCount,
                  }],
                });
                scheduleId = schedule.id;
                // The schedule's underlying Subscription doesn't exist
                // until its first phase actually starts (start_date is in
                // the future), so schedule.subscription is null here. The
                // invoice.payment_succeeded/failed handlers below backfill
                // stripe_subscription_id the first time they see it.
                subscriptionId = schedule.subscription || null;
                nextPaymentDueAt = new Date(startDate * 1000).toISOString();
              }

              await query(
                `UPDATE program_purchases
                 SET initial_payment_paid_at = now(), status = 'active',
                     stripe_customer_id = $1, stripe_subscription_schedule_id = $2,
                     stripe_subscription_id = $3, payment_plan_status = $4,
                     next_payment_due_at = $5
                 WHERE id = $6 AND initial_payment_paid_at IS NULL`,
                [
                  session.customer, scheduleId, subscriptionId,
                  remainingCount > 0 ? 'current' : 'paid_in_full',
                  nextPaymentDueAt, purchase.id,
                ]
              );
              if (remainingCount <= 0) {
                await query(
                  `UPDATE program_purchases SET paid_in_full_at = now() WHERE id = $1 AND paid_in_full_at IS NULL`,
                  [purchase.id]
                );
              }
            } else {
              // pay_in_full: nothing further is ever billed. Both facts —
              // initial payment confirmed and paid-in-full — are true the
              // same moment.
              await query(
                `UPDATE program_purchases
                 SET initial_payment_paid_at = now(), paid_in_full_at = now(),
                     status = 'active', stripe_customer_id = $1, payment_plan_status = 'paid_in_full'
                 WHERE id = $2 AND initial_payment_paid_at IS NULL`,
                [session.customer, purchase.id]
              );
            }
          }

          // Steps 3+: attempt only whichever notification is still
          // missing — initial-payment notice always applies; paid-in-full
          // notices only apply when this charge finished the plan (i.e.
          // Pay in Full, or a Monthly Plan with zero remaining installments).
          try {
            const sent = await claimAndSendNotification(purchase.id, 'initialCustomer', () => sendPlanPaymentReceivedEmail({
              to: purchase.client_email,
              name: purchase.client_name,
              tier: purchase.tier,
              amountPaidCents: session.amount_total,
              isInitial: true,
              installmentNumber: null,
              installmentCount: purchase.installment_count,
              remainingBalanceCents: purchase.payment_plan_type === 'monthly'
                ? (purchase.installment_amount_cents || 0) * (purchase.installment_count || 0)
                : 0,
              nextPaymentDate: null,
            }));
            if (!sent) console.log(`Webhook: initial-payment customer notification for purchase ${purchase.id} already sent — skipping.`);
          } catch (emailErr) {
            console.error(`PLAN_INITIAL_PAYMENT_CUSTOMER_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
          }

          try {
            const sent = await claimAndSendNotification(purchase.id, 'initialOwner', () => sendOwnerEnrollmentNotice({
              applicationId: purchase.application_id,
              purchaseId: purchase.id,
              fullName: purchase.client_name,
              tier: purchase.tier,
              amountPaidCents: session.amount_total,
              paymentStatus: purchase.payment_plan_type === 'pay_in_full' ? 'Paid in full' : 'Initial payment received — monthly plan active',
              signatureId: purchase.agreement_signature_id,
              nextAction: purchase.payment_plan_type === 'pay_in_full'
                ? 'No further payment action needed.'
                : 'Remaining installments will bill automatically. No action needed unless a charge fails.',
            }));
            if (!sent) console.log(`Webhook: initial-payment owner notification for purchase ${purchase.id} already sent — skipping.`);
          } catch (emailErr) {
            console.error(`PLAN_INITIAL_PAYMENT_OWNER_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
          }

          if (purchase.payment_plan_type === 'pay_in_full') {
            try {
              const sent = await claimAndSendNotification(purchase.id, 'paidInFullCustomer', () => sendPlanPaidInFullEmail({
                to: purchase.client_email,
                name: purchase.client_name,
                tier: purchase.tier,
              }));
              if (!sent) console.log(`Webhook: paid-in-full customer notification for purchase ${purchase.id} already sent — skipping.`);
            } catch (emailErr) {
              console.error(`PLAN_PAID_IN_FULL_CUSTOMER_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
            }
          }
        }
      } else if (bookingId) {
        // Came from our own custom checkout flow (legacy path, kept for
        // compatibility if ever re-enabled).
        const tier = session.metadata?.tier;
        const slotIso = session.metadata?.slot;
        const clientName = session.metadata?.client_name;

        await query(
          `UPDATE bookings
           SET status = 'confirmed', confirmed_at = now(),
               stripe_payment_id = $1, amount_cents = $2
           WHERE id = $3`,
          [session.payment_intent, session.amount_total, bookingId]
        );

        const slotLabel = slotIso
          ? new Date(slotIso).toLocaleString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
            })
          : 'your scheduled time';

        if (email) {
          await sendConfirmationEmail({ to: email, name: clientName, tier, slotLabel });
        }
      } else if (session.client_reference_id) {
        // Came from a Stripe Payment Link — decode what the booking page
        // packed into client_reference_id, then create the booking record
        // directly as confirmed (payment already succeeded at this point).
        let parsed;
        try {
          parsed = JSON.parse(decodeURIComponent(session.client_reference_id));
        } catch (parseErr) {
          console.error('Could not parse client_reference_id:', session.client_reference_id);
          parsed = {};
        }
        const { tier, slot, name } = parsed;

        if (tier && slot && email) {
          const insertResult = await query(
            `INSERT INTO bookings (tier, client_name, client_email, notes, slot_start, status, stripe_payment_id, amount_cents, confirmed_at)
             VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, now())
             ON CONFLICT (slot_start) WHERE status IN ('pending','confirmed') DO NOTHING
             RETURNING id`,
            [tier, name || '', email, '', slot, session.payment_intent, session.amount_total]
          );

          const slotLabel = new Date(slot).toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
          });

          if (insertResult.rows.length > 0) {
            await sendConfirmationEmail({ to: email, name, tier, slotLabel });
          } else {
            console.error('Slot already booked at webhook time for Payment Link session:', session.id);
          }
        } else {
          console.error('Payment Link session missing tier/slot/email, cannot create booking:', session.id);
        }
      } else {
        console.error('Webhook received with no booking_id and no client_reference_id — cannot reconcile.');
      }
    } catch (err) {
      // Log but still return 200 — Stripe will retry on non-2xx, and retrying
      // a DB error that isn't transient just spams retries. Alerting on this
      // log line is a good future improvement (Admin Dashboard territory).
      console.error('Error processing checkout.session.completed:', err.message);
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    // Keeps membership_status in sync with Stripe: 'cancelled' when a client
    // cancels via the Billing Portal (see api/send-membership-reminders.js for
    // where that portal link is sent) or 'paused' if CHEW sets
    // pause_collection directly (not a client-facing Billing Portal option).
    // There's no admin UI surfacing this yet — that's Admin Dashboard
    // territory (Phase 4) — but the data is ready for it.
    const subscription = event.data.object;
    let membershipStatus = 'active';
    if (event.type === 'customer.subscription.deleted' || subscription.status === 'canceled') {
      membershipStatus = 'cancelled';
    } else if (subscription.pause_collection) {
      membershipStatus = 'paused';
    } else if (subscription.status === 'trialing') {
      membershipStatus = 'trialing';
    }

    try {
      // Scoped to tier = 'membership': stripe_subscription_id is also
      // populated on one-time-engagement Monthly Plan purchases once their
      // Subscription Schedule's phase begins (see the invoice.payment_*
      // handlers below) — those are a finite program payment plan, not
      // Membership, and must never have membership_status written onto
      // them just because both happen to use a Stripe Subscription
      // underneath. "PROGRAM INSTALLMENTS ARE NOT MEMBERSHIP."
      await query(
        `UPDATE program_purchases SET membership_status = $1 WHERE stripe_subscription_id = $2 AND tier = 'membership'`,
        [membershipStatus, subscription.id]
      );
    } catch (err) {
      console.error('Error syncing subscription status:', err.message);
    }
  }

  if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed') {
    // Fires for each Monthly Plan installment billed off a Subscription
    // Schedule created in the phase === 'plan_payment' branch above (the
    // initial payment itself is charged via Checkout, not an invoice, so
    // it never reaches here). Never fires for Membership, which uses a
    // plain open-ended Subscription with its own price, not a schedule —
    // this handler only acts on purchases already marked
    // payment_plan_type = 'monthly'.
    const invoice = event.data.object;
    const invoiceId = invoice.id;
    const subscriptionId = invoice.subscription;
    const customerId = invoice.customer;
    const amountCents = event.type === 'invoice.payment_succeeded' ? invoice.amount_paid : invoice.amount_due;

    try {
      let purchase = null;
      if (subscriptionId) {
        const bySubscription = await query(
          `SELECT id, application_id, agreement_signature_id, client_name, client_email, tier,
                  installment_count, installments_paid, payment_plan_type
           FROM program_purchases WHERE stripe_subscription_id = $1 AND payment_plan_type = 'monthly'`,
          [subscriptionId]
        );
        purchase = bySubscription.rows[0] || null;
      }

      if (!purchase && customerId) {
        // First invoice off a schedule created with a future start_date:
        // schedule.subscription was still null at creation time (see the
        // phase === 'plan_payment' branch above), so this is the first
        // moment the real subscription id is knowable. Backfill it now so
        // every later invoice event finds this purchase by subscription id.
        const byCustomer = await query(
          `SELECT id, application_id, agreement_signature_id, client_name, client_email, tier,
                  installment_count, installments_paid, payment_plan_type
           FROM program_purchases
           WHERE stripe_customer_id = $1 AND payment_plan_type = 'monthly' AND stripe_subscription_id IS NULL`,
          [customerId]
        );
        purchase = byCustomer.rows[0] || null;
        if (purchase && subscriptionId) {
          await query(`UPDATE program_purchases SET stripe_subscription_id = $1 WHERE id = $2`, [subscriptionId, purchase.id]);
        }
      }

      if (!purchase) {
        console.error(`Webhook: no monthly-plan program_purchases row found for invoice ${invoiceId} (subscription ${subscriptionId}, customer ${customerId}).`);
      } else if (event.type === 'invoice.payment_succeeded') {
        const { id: installmentId, isNew } = await ensureInstallmentRecorded(purchase.id, invoiceId, amountCents, 'paid');

        if (isNew) {
          // A success after a prior failure resolves it — clear the
          // failed-notification claims so a genuinely later, different
          // failure can notify again instead of finding the columns
          // already (stale-)claimed.
          const updateResult = await query(
            `UPDATE program_purchases
             SET installments_paid = installments_paid + 1, payment_plan_status = 'current',
                 payment_failed_customer_notified_at = NULL, payment_failed_owner_notified_at = NULL
             WHERE id = $1
             RETURNING installments_paid, installment_count`,
            [purchase.id]
          );
          const updated = updateResult.rows[0];
          const paidInFull = updated.installments_paid >= updated.installment_count;

          if (paidInFull) {
            await query(
              `UPDATE program_purchases SET paid_in_full_at = now(), payment_plan_status = 'paid_in_full' WHERE id = $1 AND paid_in_full_at IS NULL`,
              [purchase.id]
            );
          }

          try {
            const sent = await claimAndSendInstallmentNotification(installmentId, () => sendPlanPaymentReceivedEmail({
              to: purchase.client_email,
              name: purchase.client_name,
              tier: purchase.tier,
              amountPaidCents: amountCents,
              isInitial: false,
              installmentNumber: updated.installments_paid,
              installmentCount: updated.installment_count,
              remainingBalanceCents: Math.max(0, updated.installment_count - updated.installments_paid) * amountCents,
              nextPaymentDate: null,
            }));
            if (!sent) console.log(`Webhook: installment notification ${installmentId} already sent — skipping.`);
          } catch (emailErr) {
            console.error(`INSTALLMENT_PAID_EMAIL_FAILED installment=${installmentId}:`, emailErr.message);
          }

          if (paidInFull) {
            try {
              const sent = await claimAndSendNotification(purchase.id, 'paidInFullCustomer', () => sendPlanPaidInFullEmail({
                to: purchase.client_email,
                name: purchase.client_name,
                tier: purchase.tier,
              }));
              if (!sent) console.log(`Webhook: paid-in-full customer notification for purchase ${purchase.id} already sent — skipping.`);
            } catch (emailErr) {
              console.error(`PLAN_PAID_IN_FULL_CUSTOMER_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
            }
            try {
              const sent = await claimAndSendNotification(purchase.id, 'paidInFullOwner', () => sendOwnerEnrollmentNotice({
                applicationId: purchase.application_id,
                purchaseId: purchase.id,
                fullName: purchase.client_name,
                tier: purchase.tier,
                amountPaidCents: amountCents,
                paymentStatus: 'Monthly plan paid in full',
                signatureId: purchase.agreement_signature_id,
                nextAction: 'No further payment action needed.',
              }));
              if (!sent) console.log(`Webhook: paid-in-full owner notification for purchase ${purchase.id} already sent — skipping.`);
            } catch (emailErr) {
              console.error(`PLAN_PAID_IN_FULL_OWNER_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
            }
          }
        } else {
          console.log(`Webhook: installment invoice ${invoiceId} already recorded — skipping.`);
        }
      } else {
        // invoice.payment_failed
        const { isNew } = await ensureInstallmentRecorded(purchase.id, invoiceId, amountCents, 'failed');
        if (isNew) {
          await query(`UPDATE program_purchases SET payment_plan_status = 'payment_failed' WHERE id = $1`, [purchase.id]);
        }

        try {
          const sent = await claimAndSendNotification(purchase.id, 'failedCustomer', () => sendPlanPaymentFailedEmail({
            to: purchase.client_email,
            name: purchase.client_name,
            tier: purchase.tier,
            amountDueCents: amountCents,
          }));
          if (!sent) console.log(`Webhook: payment-failed customer notification for purchase ${purchase.id} already sent — skipping.`);
        } catch (emailErr) {
          console.error(`PLAN_PAYMENT_FAILED_CUSTOMER_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
        }

        try {
          const sent = await claimAndSendNotification(purchase.id, 'failedOwner', () => sendOwnerPlanPaymentFailedNotice({
            purchaseId: purchase.id,
            fullName: purchase.client_name,
            email: purchase.client_email,
            tier: purchase.tier,
            amountDueCents: amountCents,
          }));
          if (!sent) console.log(`Webhook: payment-failed owner notification for purchase ${purchase.id} already sent — skipping.`);
        } catch (emailErr) {
          console.error(`PLAN_PAYMENT_FAILED_OWNER_EMAIL_FAILED purchase=${purchase.id}:`, emailErr.message);
        }
      }
    } catch (err) {
      console.error(`Error processing ${event.type}:`, err.message);
    }
  }

  return res.status(200).json({ received: true });
};
