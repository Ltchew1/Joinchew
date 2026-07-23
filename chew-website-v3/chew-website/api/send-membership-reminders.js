// /api/send-membership-reminders.js
//
// Finds Membership purchases whose first $97/month charge is about a week
// away and haven't had a reminder sent yet, sends one (with a Stripe
// Billing Portal link so the client can cancel themselves — Stripe's
// portal has no self-service pause option, only cancel), and marks them
// so they don't get a duplicate. Same manual-trigger pattern as
// api/send-reminders.js — wire this up to Vercel Cron (or trigger manually
// via ?manual=<CRON_MANUAL_SECRET>) once the site is confirmed live.
//
// Requires: DATABASE_URL, RESEND_API_KEY, FROM_EMAIL, STRIPE_SECRET_KEY, SITE_URL

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { query } = require('../lib/db');
const { sendMembershipReminderEmail } = require('../lib/email');

module.exports = async (req, res) => {
  const isCron = req.headers['x-vercel-cron'] || req.query.manual === process.env.CRON_MANUAL_SECRET;
  if (!isCron) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await query(
      `SELECT id, client_name, client_email, stripe_customer_id, membership_first_charge_at
       FROM program_purchases
       WHERE tier = 'membership'
         AND membership_status = 'trialing'
         AND membership_reminder_sent = FALSE
         AND membership_first_charge_at BETWEEN (now() + interval '6 days') AND (now() + interval '8 days')`
    );

    let sent = 0;
    for (const row of result.rows) {
      try {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: row.stripe_customer_id,
          return_url: process.env.SITE_URL,
        });

        await sendMembershipReminderEmail({
          to: row.client_email,
          name: row.client_name,
          firstChargeDate: new Date(row.membership_first_charge_at),
          portalUrl: portalSession.url,
        });

        await query(`UPDATE program_purchases SET membership_reminder_sent = TRUE WHERE id = $1`, [row.id]);
        sent++;
      } catch (err) {
        console.error(`Failed to send membership reminder for purchase ${row.id}:`, err.message);
      }
    }

    return res.status(200).json({ checked: result.rows.length, sent });
  } catch (err) {
    console.error('send-membership-reminders error:', err.message);
    return res.status(500).json({ error: 'Reminder job failed.' });
  }
};
