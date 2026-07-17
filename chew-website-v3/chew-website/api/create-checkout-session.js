// /api/create-checkout-session.js
//
// Vercel serverless function. Requires these environment variables set in
// Vercel (Project → Settings → Environment Variables) — never in this file:
//
//   STRIPE_SECRET_KEY, STRIPE_PRICE_STRATEGY, STRIPE_PRICE_GROWTH,
//   STRIPE_PRICE_EXECUTIVE, SITE_URL, DATABASE_URL
//
// Run: npm install stripe pg resend

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { query } = require('../lib/db');

const PRICE_MAP = {
  strategy: process.env.STRIPE_PRICE_STRATEGY,
  growth: process.env.STRIPE_PRICE_GROWTH,
  executive: process.env.STRIPE_PRICE_EXECUTIVE,
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tier, name, email, notes, slot } = req.body || {};
    const priceId = PRICE_MAP[tier];

    if (!priceId) return res.status(400).json({ error: 'Invalid or missing session tier.' });
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    if (!slot) return res.status(400).json({ error: 'A time slot is required.' });

    const slotDate = new Date(slot);
    if (isNaN(slotDate.getTime()) || slotDate < new Date()) {
      return res.status(400).json({ error: 'Selected time slot is invalid or in the past.' });
    }

    // Attempt to place a soft hold on this slot. The unique index on
    // (slot_start) where status is pending/confirmed makes this safe against
    // two people booking the same slot at the same time — the DB itself
    // rejects the second attempt.
    let bookingId;
    try {
      const insertResult = await query(
        `INSERT INTO bookings (tier, client_name, client_email, notes, slot_start, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id`,
        [tier, name || '', email, notes || '', slotDate.toISOString()]
      );
      bookingId = insertResult.rows[0].id;
    } catch (dbErr) {
      if (dbErr.code === '23505') { // unique constraint violation
        return res.status(409).json({ error: 'That time slot was just taken. Please pick another.' });
      }
      throw dbErr;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      metadata: {
        booking_id: String(bookingId),
        client_name: name || '',
        notes: (notes || '').slice(0, 500),
        tier,
        slot: slotDate.toISOString(),
      },
      success_url: `${process.env.SITE_URL}/booking-confirmed.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/book-consultation.html?cancelled=true`,
    });

    // Store the Stripe session id on the pending booking so the webhook can
    // reconcile it later even if metadata lookup ever needs a fallback.
    await query(`UPDATE bookings SET stripe_session_id = $1 WHERE id = $2`, [session.id, bookingId]);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session error:', err.message);
    return res.status(500).json({ error: 'Unable to create checkout session.' });
  }
};
