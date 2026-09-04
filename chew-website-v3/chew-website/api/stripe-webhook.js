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
//      pause_collection via the API/dashboard directly)
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
} = require('../lib/email');

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
const NOTIFICATION_COLUMNS = {
  entryCustomer: 'customer_enrollment_notified_at',
  entryOwner: 'owner_enrollment_notified_at',
  remainderCustomer: 'remainder_customer_notified_at',
  remainderOwner: 'remainder_owner_notified_at',
};

async function claimAndSendNotification(purchaseId, kind, sendFn) {
  const column = NOTIFICATION_COLUMNS[kind];
  if (!column) throw new Error(`Unknown notification kind: ${kind}`);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT customer_enrollment_notified_at, owner_enrollment_notified_at,
              remainder_customer_notified_at, remainder_owner_notified_at
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
                  membership_first_charge_at, remainder_payment_method, bonus_session_earned
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
      await query(
        `UPDATE program_purchases SET membership_status = $1 WHERE stripe_subscription_id = $2`,
        [membershipStatus, subscription.id]
      );
    } catch (err) {
      console.error('Error syncing subscription status:', err.message);
    }
  }

  return res.status(200).json({ received: true });
};
