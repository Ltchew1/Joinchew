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

// The one configurable admin/admissions notification address. Every
// internal (never applicant-facing) notice in this file reads this
// instead of a hardcoded address, same convention as FROM_EMAIL below.
// leroyt@joinchew.com remains only as the last-resort default so an
// unconfigured environment still reaches a real inbox rather than
// silently failing — set ADMIN_NOTIFICATION_EMAIL in Vercel to change it.
function getAdminEmail() {
  return process.env.ADMIN_NOTIFICATION_EMAIL || 'leroyt@joinchew.com';
}

// Human-readable labels for the Make Your Move answer keys (apply.html) —
// shared here so admin/applicant emails render the same words the
// applicant actually tapped, not raw machine values like "under_25k".
const ANSWER_LABELS = {
  primary_move: {
    money_organized: 'Get My Money Organized', credit_position: 'Strengthen My Credit Position',
    business_growth: 'Build/Grow My Business', funding_ready: 'Get Funding-Ready',
    prepare_home: 'Prepare for a Home', build_property: 'Build Toward Property',
    income_career: 'Increase Income/Career', protect_building: 'Protect What I’m Building',
    not_sure: 'Not Sure Yet',
  },
  income_type: {
    w2: 'W-2 / Job', business_self_employed: 'Business/Self-Employed', both: 'Both',
    fixed_benefit: 'Fixed/Benefit Income', inconsistent: 'Income Is Inconsistent',
    prefer_not_to_say: 'Prefer Not to Say',
  },
  income_range: {
    under_25k: 'Under $25K', '25k_50k': '$25K–$50K', '50k_75k': '$50K–$75K',
    '75k_100k': '$75K–$100K', '100k_150k': '$100K–$150K', '150k_250k': '$150K–$250K',
    '250k_plus': '$250K+',
  },
  savings_range: {
    under_1k: 'Under $1K', '1k_5k': '$1K–$5K', '5k_15k': '$5K–$15K',
    '15k_50k': '$15K–$50K', '50k_100k': '$50K–$100K', '100k_plus': '$100K+',
    prefer_not_to_say: 'Prefer Not to Say',
  },
  debt_range: {
    none: 'None', under_5k: 'Under $5K', '5k_15k': '$5K–$15K', '15k_50k': '$15K–$50K',
    '50k_100k': '$50K–$100K', '100k_plus': '$100K+', not_sure: 'Not Sure',
  },
  business_status: {
    no: 'No', idea_stage: 'Idea Stage', formed_no_revenue: 'Formed, No Revenue Yet',
    under_50k_year: 'Operating Under $50K/yr', '50k_250k_year': '$50K–$250K/yr',
    '250k_plus_year': '$250K+/yr',
  },
  credit_monitoring: {
    yes_regularly: 'Yes — Regularly', sometimes: 'Sometimes', no: 'No',
    not_sure_what_to_use: 'Not Sure What to Use',
  },
  primary_barrier: {
    cash_flow: 'Cash Flow', debt: 'Debt', credit_position: 'Credit Position',
    savings_reserves: 'Savings/Reserves', income: 'Income', business_structure: 'Business Structure',
    documentation: 'Documentation', funding_readiness: 'Funding Readiness',
    dont_know: 'Not Sure Yet — CHEW Will Help Find It',
  },
  organization_level: {
    real_system: 'I Have a Real System', mostly_organized: 'Mostly Organized',
    some_organized: 'Some Things Are Organized', pretty_scattered: 'Pretty Scattered',
    need_system_from_scratch: 'I Need a System From Scratch',
  },
  timeline: {
    now: 'Now', within_30_days: 'Within 30 Days', '1_3_months': '1–3 Months',
    '3_6_months': '3–6 Months', '6_12_months': '6–12 Months', just_exploring: 'Just Exploring',
  },
  help_type: {
    understand_position: 'Help Me Understand My Position', clear_strategy: 'Give Me a Clear Strategy',
    organize_pieces: 'Help Me Organize the Pieces', what_to_do_next: 'Show Me What to Do Next',
    ongoing_guidance: 'Ongoing Guidance/Accountability', not_sure: 'Not Sure Yet',
  },
};
const ANSWER_ORDER = [
  ['primary_move', 'Primary Move'], ['income_type', 'Income Type'], ['income_range', 'Income Range'],
  ['savings_range', 'Savings Range'], ['debt_range', 'Debt Range'], ['business_status', 'Business Status'],
  ['credit_monitoring', 'Credit Monitoring'], ['primary_barrier', 'Primary Barrier'],
  ['organization_level', 'Organization Level'], ['timeline', 'Timeline'], ['help_type', 'Help Type'],
];
function answerLabel(key, value) {
  return (ANSWER_LABELS[key] && ANSWER_LABELS[key][value]) || value || '—';
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
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

// Applicant confirmation — sent immediately after a successful submission.
// Reflects back only what the applicant themselves just tapped (Primary
// Move / Primary Barrier / Timeline), in their own words. Never the
// internal AI score/recommendation, never a fake turnaround time, no
// approval implied.
async function sendStartingPositionConfirmationEmail({ to, name, answers }) {
  const resend = getClient();
  const a = answers || {};

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'CHEW Has Your Starting Position',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Thank you, ${name || 'there'}.</h2>
        <p>We received your starting position.</p>
        <p>CHEW will review the facts you provided and send your next step by email.
        No approval is implied and no score is promised — every starting position is
        reviewed individually, by a person, not decided automatically.</p>
        <table style="width:100%; border-collapse:collapse; margin:24px 0; font-size:14px;">
          <tr><td style="padding:8px 0; color:#8F7024; font-weight:bold; width:140px;">Primary Move</td><td style="padding:8px 0;">${escapeHtml(answerLabel('primary_move', a.primary_move))}</td></tr>
          <tr><td style="padding:8px 0; color:#8F7024; font-weight:bold;">Primary Barrier</td><td style="padding:8px 0;">${escapeHtml(answerLabel('primary_barrier', a.primary_barrier))}</td></tr>
          <tr><td style="padding:8px 0; color:#8F7024; font-weight:bold;">Timeline</td><td style="padding:8px 0;">${escapeHtml(answerLabel('timeline', a.timeline))}</td></tr>
        </table>
        <p>No action is needed on your part right now.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

// Owner/admissions internal notification — sent immediately alongside the
// applicant confirmation. This is the fix for the reported bug: no code
// path previously sent any internal notice at all on submission (see the
// audit note in api/submit-application.js). recipient resolves via
// getAdminEmail() — never hardcoded here or by the caller.
async function sendOwnerNewApplicationNotice({ applicationId, fullName, email, phone, answers, reviewUrl }) {
  const resend = getClient();
  const a = answers || {};
  const rows = ANSWER_ORDER.map(([key, label]) =>
    `<tr><td style="padding:6px 0; color:#8F7024; font-weight:bold; width:160px;">${escapeHtml(label)}</td><td style="padding:6px 0;">${escapeHtml(answerLabel(key, a[key]))}</td></tr>`
  ).join('');

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to: getAdminEmail(),
    subject: `New CHEW Starting Position — ${fullName}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">New starting position submitted.</h2>
        <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold; width:160px;">Full Name</td><td style="padding:6px 0;">${escapeHtml(fullName)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Email</td><td style="padding:6px 0;">${escapeHtml(email)}</td></tr>
          ${phone ? `<tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Phone</td><td style="padding:6px 0;">${escapeHtml(phone)}</td></tr>` : ''}
        </table>
        <hr style="border:none; border-top:1px solid #ddd; margin:16px 0;">
        <table style="width:100%; border-collapse:collapse; font-size:14px;">${rows}</table>
        <p style="margin-top:24px;"><a href="${reviewUrl}" style="color: #8F7024; font-weight: bold;">Review in Admissions Queue &rarr;</a></p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">Internal notice — CHEW Admissions</p>
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
      <p style="font-weight:bold;">You're invited to continue with CHEW.</p>
      <p><a href="${selectProgramUrl}" style="color: #8F7024; font-weight: bold;">Continue &rarr;</a></p>
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
      <p style="font-weight:bold;">Once that's settled, you're invited to continue with CHEW.</p>
      <p><a href="${selectProgramUrl}" style="color: #8F7024; font-weight: bold;">Continue &rarr;</a></p>
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

// applicantMessage is deliberately the ONLY free-text field this function
// ever emails — the operator's internal-only note (applications.decision_note)
// must never be passed in here. See api/send-decision.js.
async function sendDecisionEmail({ to, name, decision, applicantMessage, selectProgramUrl }) {
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
        ${applicantMessage ? `<p>${escapeHtml(applicantMessage)}</p>` : ''}
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
    to: getAdminEmail(),
    subject: `Bonus session to schedule — purchase #${purchaseId}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <p><strong>${name}</strong> (${email}) paid the ${programLabel} remainder balance in full
        by card and earned a complimentary 1:1 strategy session. Please reach out to schedule it.</p>
      </div>
    `,
  });
}

// Owner enrollment notification — sent when the Stripe webhook confirms a
// successful entry-fee payment (see api/stripe-webhook.js). No card
// number, no raw Stripe customer/payment-method ids — just what an
// operator actually needs to act: who, what program, how much, whether
// the agreement is on file, and what to do next.
async function sendOwnerEnrollmentNotice({ applicationId, purchaseId, fullName, tier, amountPaidCents, paymentStatus, signatureId, nextAction }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to: getAdminEmail(),
    subject: `New CHEW Enrollment — ${fullName}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">New enrollment confirmed.</h2>
        <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold; width:170px;">Program</td><td style="padding:6px 0;">${escapeHtml(programLabel)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Amount Paid</td><td style="padding:6px 0;">${formatCents(amountPaidCents)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Payment Status</td><td style="padding:6px 0;">${escapeHtml(paymentStatus)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Agreement Signed</td><td style="padding:6px 0;">${signatureId ? 'Yes' : 'No'}</td></tr>
          ${signatureId ? `<tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Signature Reference</td><td style="padding:6px 0;">#${escapeHtml(signatureId)}</td></tr>` : ''}
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Application ID</td><td style="padding:6px 0;">#${escapeHtml(applicationId)} (internal)</td></tr>
        </table>
        <p><strong>Next operational action:</strong> ${escapeHtml(nextAction)}</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">Internal notice — CHEW Admissions</p>
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
  sendStartingPositionConfirmationEmail,
  sendOwnerNewApplicationNotice,
  sendDecisionEmail,
  sendProgramEntryConfirmationEmail,
  sendMembershipWelcomeEmail,
  sendRemainderConfirmationEmail,
  sendAdminBonusSessionNotice,
  sendOwnerEnrollmentNotice,
  sendMembershipReminderEmail,
  TIER_LABELS,
};
