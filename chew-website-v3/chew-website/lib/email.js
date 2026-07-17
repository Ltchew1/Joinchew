// lib/email.js
//
// Sends transactional emails via Resend. Requires RESEND_API_KEY and
// FROM_EMAIL set in Vercel environment variables.

const { Resend } = require('resend');

function getClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not set.');
  }
  return new Resend(process.env.RESEND_API_KEY);
}

const TIER_LABELS = {
  strategy: 'CHEW Strategy Session',
  growth: 'CHEW Growth Strategy Session',
  executive: 'CHEW Executive Strategy Session',
};

async function sendConfirmationEmail({ to, name, tier, slotLabel }) {
  const resend = getClient();
  const tierLabel = TIER_LABELS[tier] || 'CHEW Strategy Session';

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <bookings@joinchew.com>',
    to,
    subject: `Confirmed: your ${tierLabel}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">You're booked, ${name || 'there'}.</h2>
        <p>Your <strong>${tierLabel}</strong> is confirmed for:</p>
        <p style="font-size: 18px; font-weight: bold;">${slotLabel}</p>
        <p>We'll send a reminder 24 hours before your session. If you need to reschedule,
        just reply to this email.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

async function sendReminderEmail({ to, name, tier, slotLabel }) {
  const resend = getClient();
  const tierLabel = TIER_LABELS[tier] || 'CHEW Strategy Session';

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <bookings@joinchew.com>',
    to,
    subject: `Reminder: your ${tierLabel} is tomorrow`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">See you soon, ${name || 'there'}.</h2>
        <p>This is a reminder that your <strong>${tierLabel}</strong> is coming up:</p>
        <p style="font-size: 18px; font-weight: bold;">${slotLabel}</p>
        <p>If anything's changed and you need to reschedule, just reply to this email.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

module.exports = { sendConfirmationEmail, sendReminderEmail, TIER_LABELS };
