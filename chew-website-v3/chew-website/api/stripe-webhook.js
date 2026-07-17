// /api/stripe-webhook.js
//
// Stripe calls this endpoint directly (not the browser) when a payment event
// happens. This is what makes booking actually "automated" — without this,
// CHEW's database never learns that a payment succeeded.
//
// SETUP REQUIRED IN STRIPE DASHBOARD:
//   1. Go to Developers → Webhooks → Add endpoint
//   2. Endpoint URL: https://www.joinchew.com/api/stripe-webhook
//   3. Select event: checkout.session.completed
//   4. Copy the "Signing secret" (starts with whsec_...) into Vercel as
//      STRIPE_WEBHOOK_SECRET — never in this file.
//
// Requires: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, DATABASE_URL,
// RESEND_API_KEY, FROM_EMAIL

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { query } = require('../lib/db');
const { sendConfirmationEmail } = require('../lib/email');

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
    const email = session.customer_email || session.customer_details?.email;

    try {
      if (bookingId) {
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

  return res.status(200).json({ received: true });
};
