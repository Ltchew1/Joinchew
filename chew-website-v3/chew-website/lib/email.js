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
    body: (selectProgramUrl) => `
      <p>After reviewing your application, we're glad to move forward with you.</p>
      <p>Choose your program to get started:</p>
      <p><a href="${selectProgramUrl}" style="color: #8F7024; font-weight: bold;">Choose your program</a></p>
      <p>You'll also get a separate email inviting you to set up your CHEW Client Portal
      account, where your Blueprint and roadmap will appear as your strategist puts them together.</p>
    `,
  },
  ACCEPT_WITH_CONDITIONS: {
    subject: 'Your CHEW application — accepted, with next steps',
    heading: (name) => `Good news, ${name || 'there'} — with a next step first.`,
    body: (selectProgramUrl) => `
      <p>After reviewing your application, we'd like to move forward with you, with
      one or more conditions to put in place first. We'll lay those out directly in a
      follow-up so there's no ambiguity about what's needed.</p>
      <p>Once that's settled, you can choose your program here:</p>
      <p><a href="${selectProgramUrl}" style="color: #8F7024; font-weight: bold;">Choose your program</a></p>
      <p>You'll also get a separate email inviting you to set up your CHEW Client Portal
      account, where your Blueprint and roadmap will appear as your strategist puts them together.</p>
    `,
  },
  WAITLIST: {
    subject: 'Your CHEW application — waitlisted',
    heading: (name) => `Thank you for applying, ${name || 'there'}.`,
    body: () => `
      <p>We reviewed your application carefully. Rather than admit you before we're
      confident we can serve you well, we're placing you on our waitlist. We'd rather
      serve fewer clients completely than many clients poorly.</p>
      <p>We'll reach out as soon as a spot opens that's the right fit.</p>
    `,
  },
  REFER_ELSEWHERE: {
    subject: 'Your CHEW application',
    heading: (name) => `Thank you for applying, ${name || 'there'}.`,
    body: () => `
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
    body: () => `
      <p>We reviewed your application and think the timing isn't quite right yet.
      We'd genuinely welcome a reapplication once your situation develops further.</p>
    `,
  },
};

async function sendDecisionEmail({ to, name, decision, note, selectProgramUrl }) {
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
        ${content.body(selectProgramUrl)}
        ${note ? `<p>${note}</p>` : ''}
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

const PROGRAM_LABELS = {
  infrastructure: 'Infrastructure Program',
  executive: 'Executive Advisory',
  membership: 'Membership',
};

function formatCents(cents) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

async function sendProgramEntryConfirmationEmail({ to, name, tier, remainderAmountCents, payRemainderUrl }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: `You're in — ${programLabel} entry fee received`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Welcome to the ${programLabel}, ${name || 'there'}.</h2>
        <p>Your entry fee has been received. The remaining balance of
        <strong>${formatCents(remainderAmountCents)}</strong> is credited from your entry fee against
        the program's full cost.</p>
        <p>When you're ready, you can pay the remainder in full by card (and receive a complimentary
        1:1 strategy session as our thank-you — not a discount), or split it via Klarna or Afterpay:</p>
        <p><a href="${payRemainderUrl}" style="color: #8F7024; font-weight: bold;">Pay your remaining balance</a></p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

async function sendMembershipWelcomeEmail({ to, name, firstChargeDate }) {
  const resend = getClient();

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Welcome to CHEW Membership',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Welcome, ${name || 'there'}.</h2>
        <p>Your Membership entry fee has been received. Your $97/month membership begins on
        <strong>${formatDate(firstChargeDate)}</strong> — nothing further is due before then.</p>
        <p>We'll send a reminder a week before your first charge, with an easy way to cancel
        any time.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

async function sendRemainderConfirmationEmail({ to, name, tier, bonusEarned }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: `${programLabel} — payment complete`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">You're fully set up, ${name || 'there'}.</h2>
        <p>Your ${programLabel} balance has been paid in full. We're glad to have you.</p>
        ${bonusEarned ? '<p>As a thank-you for paying in full, you\'ve earned a complimentary 1:1 strategy session — we\'ll reach out directly to schedule it.</p>' : ''}
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

async function sendAdminBonusSessionNotice({ purchaseId, name, email, tier }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to: 'leroyt@joinchew.com',
    subject: `Bonus session to schedule — purchase #${purchaseId}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <p><strong>${name}</strong> (${email}) paid the ${programLabel} remainder balance in full
        by card and earned a complimentary 1:1 strategy session. Please reach out to schedule it.</p>
      </div>
    `,
  });
}

async function sendMembershipReminderEmail({ to, name, firstChargeDate, portalUrl }) {
  const resend = getClient();

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Your CHEW membership charge is coming up',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">A heads-up, ${name || 'there'}.</h2>
        <p>Your first $97 monthly membership charge will process on
        <strong>${formatDate(firstChargeDate)}</strong>.</p>
        <p>If you'd like to cancel before then, you can do that yourself here:</p>
        <p><a href="${portalUrl}" style="color: #8F7024; font-weight: bold;">Manage your membership</a></p>
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
  sendProgramEntryConfirmationEmail,
  sendMembershipWelcomeEmail,
  sendRemainderConfirmationEmail,
  sendAdminBonusSessionNotice,
  sendMembershipReminderEmail,
  TIER_LABELS,
};
