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

async function sendApplicationReceivedEmail({ to, name }) {
  const resend = getClient();

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Your CHEW application has been received',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Thank you, ${name || 'there'}.</h2>
        <p>Your application to CHEW has been received. We review every application
        individually — there's no automated approval or denial.</p>
        <p>You'll hear from us directly once a decision has been made. In the meantime,
        no action is needed on your part.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

const DECISION_CONTENT = {
  ACCEPT: {
    subject: 'Welcome to CHEW',
    heading: (name) => `You're in, ${name || 'there'}.`,
    body: `
      <p>After reviewing your application, we're glad to move forward with you.</p>
      <p>We'll be in touch shortly with next steps to begin your Financial Blueprint
      Assessment and get your program underway.</p>
    `,
  },
  ACCEPT_WITH_CONDITIONS: {
    subject: 'Your CHEW application — accepted, with next steps',
    heading: (name) => `Good news, ${name || 'there'} — with a next step first.`,
    body: `
      <p>After reviewing your application, we'd like to move forward with you, with
      one or more conditions to put in place first. We'll lay those out directly in a
      follow-up so there's no ambiguity about what's needed.</p>
    `,
  },
  WAITLIST: {
    subject: 'Your CHEW application — waitlisted',
    heading: (name) => `Thank you for applying, ${name || 'there'}.`,
    body: `
      <p>We reviewed your application carefully. Rather than admit you before we're
      confident we can serve you well, we're placing you on our waitlist. We'd rather
      serve fewer clients completely than many clients poorly.</p>
      <p>We'll reach out as soon as a spot opens that's the right fit.</p>
    `,
  },
  REFER_ELSEWHERE: {
    subject: 'Your CHEW application',
    heading: (name) => `Thank you for applying, ${name || 'there'}.`,
    body: `
      <p>After reviewing your application, we don't think CHEW is the right fit for
      where you are right now — and we'd rather tell you that directly than take you
      on anyway.</p>
      <p>In the meantime, our <a href="https://www.joinchew.com/resources.html" style="color:#8F7024;">
      free resource library</a> covers many of the same fundamentals we teach clients,
      at no cost.</p>
    `,
  },
  REAPPLY_LATER: {
    subject: 'Your CHEW application — reapply soon',
    heading: (name) => `Thank you for applying, ${name || 'there'}.`,
    body: `
      <p>We reviewed your application and think the timing isn't quite right yet.
      We'd genuinely welcome a reapplication once your situation develops further.</p>
    `,
  },
};

async function sendDecisionEmail({ to, name, decision, note }) {
  const resend = getClient();
  const content = DECISION_CONTENT[decision];
  if (!content) throw new Error(`Unknown decision type: ${decision}`);

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: content.subject,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">${content.heading(name)}</h2>
        ${content.body}
        ${note ? `<p>${note}</p>` : ''}
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

module.exports = {
  sendConfirmationEmail,
  sendReminderEmail,
  sendApplicationReceivedEmail,
  sendDecisionEmail,
  TIER_LABELS,
};
