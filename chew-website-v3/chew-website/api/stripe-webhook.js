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
const { query } = require('../lib/db');
const {
  sendConfirmationEmail,
  sendProgramEntryConfirmationEmail,
  sendMembershipWelcomeEmail,
  sendRemainderConfirmationEmail,
  sendAdminBonusSessionNotice,
} = require('../lib/email');

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
          `SELECT id, access_token, tier, client_name, client_email, remainder_amount_cents
           FROM program_purchases WHERE id = $1`,
          [purchaseId]
        );
        const purchase = purchaseResult.rows[0];

        if (!purchase) {
          console.error('Webhook: program_purchases row not found for id', purchaseId);
        } else if (phase === 'entry') {
          if (purchase.tier === 'membership') {
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            const firstChargeAt = new Date(subscription.trial_end * 1000);

            await query(
              `UPDATE program_purchases
               SET entry_paid_at = now(), status = 'complete',
                   stripe_customer_id = $1, stripe_subscription_id = $2,
                   membership_first_charge_at = $3, membership_status = 'trialing'
               WHERE id = $4`,
              [session.customer, session.subscription, firstChargeAt.toISOString(), purchase.id]
            );

            await sendMembershipWelcomeEmail({
              to: purchase.client_email,
              name: purchase.client_name,
              firstChargeDate: firstChargeAt,
            });
          } else {
            await query(
              `UPDATE program_purchases SET entry_paid_at = now(), status = 'pending_remainder' WHERE id = $1`,
              [purchase.id]
            );

            await sendProgramEntryConfirmationEmail({
              to: purchase.client_email,
              name: purchase.client_name,
              tier: purchase.tier,
              remainderAmountCents: purchase.remainder_amount_cents,
              payRemainderUrl: `${process.env.SITE_URL}/pay-remainder.html?token=${encodeURIComponent(purchase.access_token)}`,
            });
          }
        } else if (phase === 'remainder') {
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

          const bonusEarned = methodType === 'card';
          await query(
            `UPDATE program_purchases
             SET remainder_paid_at = now(), remainder_payment_method = $1,
                 bonus_session_earned = $2, status = 'complete'
             WHERE id = $3`,
            [methodType, bonusEarned, purchase.id]
          );

          await sendRemainderConfirmationEmail({
            to: purchase.client_email,
            name: purchase.client_name,
            tier: purchase.tier,
            bonusEarned,
          });

          if (bonusEarned) {
            await sendAdminBonusSessionNotice({
              purchaseId: purchase.id,
              name: purchase.client_name,
              email: purchase.client_email,
              tier: purchase.tier,
            });
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
