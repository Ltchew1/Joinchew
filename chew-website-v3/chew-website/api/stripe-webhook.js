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
// Records an installment outcome, and recognizes a genuine CURE: Stripe
// automatically retries a failed subscription invoice against the SAME
// invoice id (it does not create a new one), so invoice.payment_failed
// followed later by invoice.payment_succeeded for that identical invoice
// id is the NORMAL retry path, not an edge case -- a plain ON CONFLICT DO
// NOTHING (the original design) would silently ignore that cure forever,
// since the row already "exists." This upgrades a stored 'failed' row to
// 'paid' when a success arrives for the same invoice, but the WHERE
// clause is one-directional on purpose: it can never downgrade a 'paid'
// row back to 'failed' if a stale/out-of-order failed event for that same
// invoid arrives after the cure was already recorded (payment state must
// be monotonic -- a real cure is never undone by a stale retry-failure
// notification arriving late). isNew now means "this call caused a real
// state transition" (first-ever record OR a genuine failed->paid cure),
// not merely "this invoice id was never seen before" -- callers use it to
// decide whether to act (increment installments_paid, send a notice) or
// treat the event as an already-accounted-for duplicate/stale replay.
async function ensureInstallmentRecorded(purchaseId, invoiceId, amountCents, status) {
  const insertResult = await query(
    `INSERT INTO program_purchase_installments (purchase_id, stripe_invoice_id, amount_cents, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stripe_invoice_id) DO UPDATE
       SET status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents
       WHERE program_purchase_installments.status = 'failed' AND EXCLUDED.status = 'paid'
     RETURNING id, status`,
    [purchaseId, invoiceId, amountCents, status]
  );
  if (insertResult.rows[0]) {
    return { id: insertResult.rows[0].id, status: insertResult.rows[0].status, isNew: true };
  }
  const existing = await query(
    `SELECT id, status FROM program_purchase_installments WHERE stripe_invoice_id = $1`,
    [invoiceId]
  );
  return { id: existing.rows[0].id, status: existing.rows[0].status, isNew: false };
}

// Adds one calendar month rather than a flat 30*24*60*60 second offset —
// "approximately one billing month later" per locked doctrine, computed the
// same way a human reading a calendar would (Jan 15 -> Feb 15), not a
// day-count approximation that drifts across months of different lengths.
//
// CHEW month-end billing rule: if the original billing day doesn't exist in
// the target month, use the LAST VALID DAY of that target month. Naive
// JS Date arithmetic (`Date.UTC(y, m+1, originalDay)`) does NOT do this —
// passing day 31 for a month that only has 28 days silently overflows into
// the month after (Jan 31 -> Mar 3, not Feb 28), which is exactly the
// "expected Feb 28, got Mar 3" bug this function must not have. Explicitly
// clamps to the target month's real last day instead of relying on
// rollover. All Stripe timestamps here are computed in UTC, consistently
// with `start_date`'s own units (a Unix timestamp has no timezone of its
// own, but every calendar computation feeding into it is UTC end to end,
// so there's no local-timezone drift to reason about separately).
function addOneCalendarMonthUnix(fromUnixSeconds) {
  const d = new Date(fromUnixSeconds * 1000);
  const year = d.getUTCFullYear();
  const targetMonth = d.getUTCMonth() + 1; // may be 12; Date.UTC normalizes that into January of year+1
  // Date.UTC(y, m, 0) is the standard trick for "the last day of month m-1"
  // — so target month's last day is Date.UTC(y, targetMonth + 1, 0).
  const lastDayOfTargetMonth = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d.getUTCDate(), lastDayOfTargetMonth);
  const next = new Date(Date.UTC(
    year, targetMonth, clampedDay,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()
  ));
  return Math.floor(next.getTime() / 1000);
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

  // RETRY POLICY: a genuinely incomplete piece of durable processing (a DB
  // write that should have happened but threw, a notification that should
  // have sent but the provider call failed) must make Stripe retry this
  // event automatically -- returning 200 anyway silently strands that work
  // forever, since most of these events (checkout.session.completed,
  // invoice.payment_*) fire exactly once per real-world occurrence, so
  // there is no later event to "catch it up." Every write in this file is
  // already retry-safe by construction (WHERE ...IS NULL guards, ON
  // CONFLICT DO NOTHING, a deterministic Stripe idempotency key on
  // schedule creation, and claim-before-send notification columns), so a
  // retry can never double-charge, double-create, or double-notify -- it
  // can only finish what didn't durably complete. This flag is set by
  // anything that represents such a failure; conditions that are business-
  // logic outcomes rather than processing failures (a purchase row that
  // genuinely doesn't exist, a malformed/unreconcilable legacy event) are
  // logged but deliberately do NOT set it, since retrying those can never
  // produce a different result.
  let hasRetryableFailure = false;

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
            hasRetryableFailure = true;
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
            hasRetryableFailure = true;
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
            hasRetryableFailure = true;
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
              hasRetryableFailure = true;
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
                const startDate = addOneCalendarMonthUnix(Math.floor(Date.now() / 1000));

                // Bind the SAME payment method the client just used for the
                // initial payment, rather than leaving it to an ambiguous
                // Stripe Customer default — the Checkout Session saved it
                // (setup_future_usage: 'off_session') but did not otherwise
                // designate it as the customer's default anywhere.
                let defaultPaymentMethod;
                try {
                  const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
                  defaultPaymentMethod = paymentIntent.payment_method || undefined;
                } catch (pmErr) {
                  console.error(`Could not resolve initial payment method for purchase ${purchase.id}, schedule will fall back to the Customer default:`, pmErr.message);
                }

                // Idempotency key deterministic per purchase: if Stripe
                // successfully creates the schedule but the subsequent DB
                // UPDATE below fails (connection drop, etc.), the row-level
                // WHERE ...IS NULL guard alone cannot prevent a webhook
                // retry from calling create() a second time — that would be
                // a genuine duplicate external Stripe object, not just a
                // duplicate DB write. Passing the same key on every attempt
                // makes Stripe return the ORIGINAL schedule instead of
                // creating a second one.
                const schedule = await stripe.subscriptionSchedules.create({
                  customer: session.customer,
                  start_date: startDate,
                  end_behavior: 'cancel',
                  default_settings: defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : undefined,
                  phases: [{
                    // Stripe copies phase metadata onto the underlying
                    // Subscription when this phase begins, and every invoice
                    // snapshots it at finalization (invoice.subscription_details.metadata)
                    // — this is what api/stripe-webhook.js's invoice.payment_*
                    // handlers use as the primary, spoof-resistant way to
                    // identify which CHEW purchase an installment belongs to,
                    // instead of guessing from a bare customer id.
                    metadata: { purchase_id: String(purchase.id), kind: 'chew_program_installment_plan' },
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
                }, { idempotencyKey: `plan-schedule:${purchase.id}` });
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
            hasRetryableFailure = true;
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
            hasRetryableFailure = true;
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
              hasRetryableFailure = true;
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
      // Anything reaching here escaped every inline try/catch above, which
      // means it's an unclassified failure during required durable
      // processing (a DB write, a Stripe API call) -- not a business-logic
      // outcome already logged and moved past. Every write in this branch
      // is retry-safe (WHERE ...IS NULL guards, a deterministic Stripe
      // idempotency key on schedule creation), so the right response is to
      // make Stripe retry, not to silently drop the event. Alerting on this
      // log line is a good future improvement (Admin Dashboard territory).
      console.error('Error processing checkout.session.completed:', err.message);
      hasRetryableFailure = true;
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
      hasRetryableFailure = true;
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
    // The most trustworthy signal available: the purchase_id CHEW stamps
    // onto the Subscription Schedule's phase metadata at creation time
    // (see the phase === 'plan_payment' branch above), which Stripe copies
    // onto the underlying Subscription when that phase begins and snapshots
    // onto every invoice at finalization. An invoice can only carry this key
    // if it genuinely came from a schedule CHEW created for THIS program
    // installment plan — Membership's plain Subscription, an unrelated
    // future Stripe product, or a test invoice never has it, so this can't
    // be spoofed by coincidence the way a bare customer-id match could be.
    const metadataPurchaseId = invoice.subscription_details?.metadata?.purchase_id
      ? Number(invoice.subscription_details.metadata.purchase_id)
      : null;

    try {
      let purchase = null;

      if (metadataPurchaseId) {
        const byMetadata = await query(
          `SELECT id, application_id, agreement_signature_id, client_name, client_email, tier,
                  installment_count, installments_paid, payment_plan_type, paid_in_full_at
           FROM program_purchases WHERE id = $1 AND payment_plan_type = 'monthly'`,
          [metadataPurchaseId]
        );
        purchase = byMetadata.rows[0] || null;
      }

      if (!purchase && subscriptionId) {
        const bySubscription = await query(
          `SELECT id, application_id, agreement_signature_id, client_name, client_email, tier,
                  installment_count, installments_paid, payment_plan_type, paid_in_full_at
           FROM program_purchases WHERE stripe_subscription_id = $1 AND payment_plan_type = 'monthly'`,
          [subscriptionId]
        );
        purchase = bySubscription.rows[0] || null;
      }

      if (!purchase && customerId) {
        // Last-resort fallback for an invoice with neither metadata nor a
        // recognized subscription id yet (the very first invoice off a
        // schedule created with a future start_date, before schedule.subscription
        // was knowable). Scoped tightly to payment_plan_type = 'monthly' AND
        // stripe_subscription_id IS NULL, so it can only ever match a
        // purchase genuinely still waiting for its first installment —
        // never a Membership row (payment_plan_type is always null there)
        // and never a purchase that already has a subscription id bound.
        const byCustomer = await query(
          `SELECT id, application_id, agreement_signature_id, client_name, client_email, tier,
                  installment_count, installments_paid, payment_plan_type, paid_in_full_at
           FROM program_purchases
           WHERE stripe_customer_id = $1 AND payment_plan_type = 'monthly' AND stripe_subscription_id IS NULL`,
          [customerId]
        );
        purchase = byCustomer.rows[0] || null;
      }

      if (purchase && subscriptionId) {
        // Idempotent regardless of which lookup path found the purchase —
        // a no-op once already backfilled.
        await query(
          `UPDATE program_purchases SET stripe_subscription_id = $1 WHERE id = $2 AND stripe_subscription_id IS NULL`,
          [subscriptionId, purchase.id]
        );
      }

      if (!purchase) {
        // Unlike the checkout.session.completed "purchase not found" case
        // (that row is always created before the Stripe session exists, so
        // "not found" there is a genuine anomaly), this one has a real
        // theoretical race: the backfill this lookup depends on
        // (stripe_customer_id / stripe_subscription_id) is written by the
        // EARLIER checkout.session.completed delivery for the same
        // purchase. If that delivery is unusually delayed, this invoice
        // event could arrive first and legitimately find nothing yet.
        // Retryable so Stripe's own backoff gives that race a chance to
        // resolve; if it's a genuine orphan invoice, Stripe's retry window
        // is bounded and it simply stops retrying after it expires.
        console.error(`Webhook: no monthly-plan program_purchases row found for invoice ${invoiceId} (subscription ${subscriptionId}, customer ${customerId}).`);
        hasRetryableFailure = true;
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
            hasRetryableFailure = true;
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
              hasRetryableFailure = true;
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
              hasRetryableFailure = true;
            }
          }
        } else {
          console.log(`Webhook: installment invoice ${invoiceId} already recorded — skipping.`);
        }
      } else {
        // invoice.payment_failed. isNew is false for: a duplicate failed
        // redelivery of an already-recorded failure, AND (critically) a
        // STALE/out-of-order failed event arriving for an invoice that a
        // later invoice.payment_succeeded already cured -- the ledger
        // update in ensureInstallmentRecorded is one-directional (never
        // downgrades a stored 'paid' row back to 'failed'), so isNew=false
        // there too. Only act on a genuine, new failure transition;
        // otherwise the stale event must be a complete no-op, since
        // reacting to it would re-alarm a customer/owner about a payment
        // that has actually already succeeded.
        const { isNew } = await ensureInstallmentRecorded(purchase.id, invoiceId, amountCents, 'failed');

        if (!isNew) {
          console.log(`Webhook: failed event for invoice ${invoiceId} is a duplicate or a stale/out-of-order replay of an already-cured installment — no action taken.`);
        } else if (purchase.paid_in_full_at) {
          // Defensive: the plan already reached paid-in-full (the schedule
          // should have stopped generating invoices at that point --
          // end_behavior: 'cancel' -- so this should not normally happen,
          // but payment state must never regress a completed plan back to
          // "failed" over a late/anomalous Stripe event).
          console.log(`Webhook: failed event for invoice ${invoiceId} arrived after purchase ${purchase.id} was already paid in full — ignoring, not downgrading payment_plan_status.`);
        } else {
          await query(`UPDATE program_purchases SET payment_plan_status = 'payment_failed' WHERE id = $1`, [purchase.id]);

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
            hasRetryableFailure = true;
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
            hasRetryableFailure = true;
          }
        }
      }
    } catch (err) {
      console.error(`Error processing ${event.type}:`, err.message);
      hasRetryableFailure = true;
    }
  }

  // A non-2xx here is Stripe's own signal to retry this exact event later
  // on its normal backoff schedule -- never something this handler builds
  // itself. Safe by construction: every write above is idempotent (WHERE
  // ...IS NULL guards, ON CONFLICT DO NOTHING, a deterministic Stripe
  // idempotency key on schedule creation, claim-before-send notification
  // columns), so a retry can only finish incomplete work, never repeat
  // completed work.
  if (hasRetryableFailure) {
    return res.status(500).json({ error: 'Processing incomplete, please retry.' });
  }
  return res.status(200).json({ received: true });
};
