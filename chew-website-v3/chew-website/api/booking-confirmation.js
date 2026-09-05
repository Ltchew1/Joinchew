// /api/booking-confirmation.js
//
// Read-only lookup for booking-confirmed.html, keyed by the Stripe Checkout
// Session id Stripe itself puts in the success_url ({CHECKOUT_SESSION_ID}) —
// not a sequential program_purchases id. A Checkout Session id is a long,
// unguessable, single-use Stripe identifier, the same class of correlation
// mechanism api/purchase-summary.js already uses (an opaque access_token),
// so this reuses that existing pattern rather than inventing a new one.
//
// Authoritative payment success is checkout.session.completed landing on
// api/stripe-webhook.js and setting entry_paid_at — never the browser
// merely arriving at this URL. This endpoint reports exactly that DB state:
// entry_paid_at IS NULL means Stripe redirected the browser here before the
// webhook (or its retries) finished, and the caller should show a
// processing state and re-poll rather than anything claiming success.
//
// Returns only what a confirmation page needs to render honestly — no
// database ids, no signature id, no application access token, no Stripe
// customer/subscription/session ids, no admin secret, no IP address, no AI
// scoring, no internal notes.
//
// GET /api/booking-confirmation?session_id=<Stripe Checkout Session id>

const { query } = require('../lib/db');

const PROGRAM_LABELS = {
  infrastructure: 'Infrastructure Program',
  executive: 'Executive Advisory',
  membership: 'Membership',
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id: sessionId } = req.query || {};
  if (!sessionId) return res.status(400).json({ error: 'Missing session_id.' });

  try {
    const result = await query(
      `SELECT tier, client_name, entry_amount_cents, entry_paid_at, remainder_amount_cents,
              status, membership_status, agreement_signature_id
       FROM program_purchases WHERE entry_stripe_session_id = $1`,
      [sessionId]
    );
    const purchase = result.rows[0];
    if (!purchase) {
      return res.status(404).json({ error: 'No purchase found for this checkout session.' });
    }

    if (!purchase.entry_paid_at) {
      // Stripe already redirected the browser (checkout succeeded from the
      // customer's side), but our own webhook hasn't landed yet. This is
      // truthfully "processing," not "enrolled."
      return res.status(200).json({ processing: true });
    }

    let agreementSigned = false;
    if (purchase.agreement_signature_id) {
      const sigResult = await query(`SELECT id FROM agreement_signatures WHERE id = $1`, [purchase.agreement_signature_id]);
      agreementSigned = sigResult.rows.length > 0;
    }

    const isMembership = purchase.tier === 'membership';
    const enrolled = purchase.status === 'complete' || purchase.membership_status === 'trialing' || purchase.membership_status === 'active';

    let nextAction;
    if (isMembership) {
      nextAction = 'Your membership is active. Nothing further is due until your first monthly charge — we’ll send a reminder beforehand.';
    } else if (enrolled) {
      nextAction = 'Your program is paid in full. CHEW will be in touch with your next steps.';
    } else {
      nextAction = 'Your entry fee is confirmed. A separate email has your link to pay the remaining balance whenever you’re ready.';
    }

    return res.status(200).json({
      processing: false,
      program: PROGRAM_LABELS[purchase.tier] || purchase.tier,
      fullName: purchase.client_name,
      amountPaidCents: purchase.entry_amount_cents,
      isMembership,
      agreementSigned,
      enrolled,
      enrollmentStatusLabel: enrolled ? 'Enrolled' : 'Payment Completed — Remainder Pending',
      nextAction,
    });
  } catch (err) {
    console.error('booking-confirmation error:', err.message);
    return res.status(500).json({ error: 'Unable to load your confirmation.' });
  }
};
