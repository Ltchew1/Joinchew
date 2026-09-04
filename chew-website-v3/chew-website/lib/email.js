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
    subject: "You've been accepted to continue with CHEW",
    heading: (name) => `You've been accepted, ${name || 'there'}.`,
    body: () => `
      <p>After reviewing your application, we're glad to move forward with you.</p>
      <p>CHEW is now reviewing the Starting Position you submitted to determine the
      appropriate engagement scope for where you are. We don't hand every accepted
      applicant the same package — we look at your actual position first, then
      recommend the right level of structure for it.</p>
      <p>You'll receive a separate email — <strong>Your CHEW Recommendation Is
      Ready</strong> — as soon as that review is complete, with the specific
      engagement we recommend and why.</p>
      <p>You'll also get a separate email inviting you to set up your CHEW Client Portal
      account, where your Blueprint and roadmap will appear as your strategist puts them together.</p>
    `,
  },
  ACCEPT_WITH_CONDITIONS: {
    subject: 'Your CHEW application — accepted, with next steps',
    heading: (name) => `Good news, ${name || 'there'} — with a next step first.`,
    body: () => `
      <p>After reviewing your application, we'd like to move forward with you, with
      one or more conditions to put in place first. We'll lay those out directly in a
      follow-up so there's no ambiguity about what's needed.</p>
      <p>CHEW is also reviewing the Starting Position you submitted to determine the
      appropriate engagement scope. You'll receive a separate email — <strong>Your
      CHEW Recommendation Is Ready</strong> — with the specific engagement we
      recommend, and it will show any conditions that need to be in place before
      you can move into contracting.</p>
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
//
// Deliberately does NOT link to any program-selection page — admissions
// (this email) and scope/recommendation (sendRecommendationReadyEmail,
// below) are different events sent at different times, per the CHEW
// Recommendation Engine doctrine: an ACCEPT decision never implies a
// specific engagement has been approved yet.
async function sendDecisionEmail({ to, name, decision, applicantMessage }) {
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
        ${content.body()}
        ${applicantMessage ? `<p>${escapeHtml(applicantMessage)}</p>` : ''}
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

// Sent separately from sendDecisionEmail, once an admin clicks "Approve &
// Send" in the Scope Builder (see api/save-recommendation.js) — the
// second, distinct lifecycle moment the CHEW Recommendation Engine
// doctrine requires: acceptance and scope approval are different facts,
// and this email is the one that first tells a client which specific
// engagement CHEW is recommending.
async function sendRecommendationReadyEmail({ to, name, engagementLabel, clientFacingReason, recommendationUrl }) {
  const resend = getClient();
  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Your CHEW Recommendation Is Ready',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Your CHEW Recommendation Is Ready, ${name || 'there'}.</h2>
        <p>We reviewed the Starting Position you submitted. There's a clear place to begin.</p>
        <p><strong>Recommended engagement:</strong> ${escapeHtml(engagementLabel)}</p>
        <p><strong>Why this fits:</strong> ${escapeHtml(clientFacingReason)}</p>
        <p><a href="${recommendationUrl}" style="color: #8F7024; font-weight: bold;">View My CHEW Recommendation &rarr;</a></p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

// Internal-only — notifies the configured admin address when a client
// requests a scope review on their active recommendation (see
// api/request-scope-review.js). Never sent to the applicant.
async function sendScopeReviewRequestNotice({ applicantName, applicantEmail, engagementLabel, message, adminApplicationUrl }) {
  const resend = getClient();
  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to: getAdminEmail(),
    subject: `Scope review requested — ${applicantName || applicantEmail}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Scope Review Requested</h2>
        <p><strong>${escapeHtml(applicantName || '')}</strong> (${escapeHtml(applicantEmail || '')})
        requested a review of their recommended engagement (${escapeHtml(engagementLabel || '')}).</p>
        ${message ? `<p><strong>Their message:</strong></p><p>${escapeHtml(message)}</p>` : '<p>No additional message was provided.</p>'}
        ${adminApplicationUrl ? `<p><a href="${adminApplicationUrl}" style="color:#8F7024; font-weight:bold;">Open in Admissions Queue &rarr;</a></p>` : ''}
      </div>
    `,
  });
}

// Three honest, single-shot follow-up nudges for the CHEW Recommendation
// Engine (see api/send-recommendation-reminders.js for the cron job that
// sends these and the claim-once columns that stop duplicates). No
// countdown, no scarcity, no invented deadline — each just restates
// where the applicant left off and links back to the same page.
async function sendRecommendationNotViewedReminderEmail({ to, name, recommendationUrl }) {
  const resend = getClient();
  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Your CHEW Recommendation Is Ready',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Still here whenever you're ready, ${name || 'there'}.</h2>
        <p>CHEW put together a recommended engagement for you based on your Starting Position. It's still waiting whenever you have a few minutes to look it over.</p>
        <p><a href="${recommendationUrl}" style="color: #8F7024; font-weight: bold;">View My CHEW Recommendation &rarr;</a></p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

async function sendChooseEngagementReminderEmail({ to, name, recommendationUrl }) {
  const resend = getClient();
  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Continuing Your CHEW Recommendation',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Picking back up, ${name || 'there'}?</h2>
        <p>You looked over your CHEW recommendation but haven't chosen an engagement yet. If you have a question about it, or want a different starting point, you can also request a scope review directly from that page.</p>
        <p><a href="${recommendationUrl}" style="color: #8F7024; font-weight: bold;">Return to My CHEW Recommendation &rarr;</a></p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

async function sendSignAgreementReminderEmail({ to, name, signAgreementUrl }) {
  const resend = getClient();
  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Finishing Your CHEW Engagement Setup',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">One step left, ${name || 'there'}.</h2>
        <p>You chose your CHEW engagement, but the Client Services Agreement hasn't been signed yet. Nothing is charged until you sign and confirm payment.</p>
        <p><a href="${signAgreementUrl}" style="color: #8F7024; font-weight: bold;">Continue to the Agreement &rarr;</a></p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

const PROGRAM_LABELS = {
  focused_builder: 'Focused Builder',
  infrastructure: 'Infrastructure',
  advanced_infrastructure: 'Advanced Infrastructure',
  executive: 'Executive Advisory',
  membership: 'Membership',
};

function formatCents(cents) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// The one transactional "you paid, here's where things stand" email for the
// entry-fee/remainder-pending path (Infrastructure/Executive). agreementSigned
// is passed in by the caller (api/stripe-webhook.js), which already knows it
// from the same program_purchases row this send is gated on — a checkout
// session can't exist without a valid signature, so this is real state, not
// an assumption made in this file.
async function sendProgramEntryConfirmationEmail({ to, name, tier, amountPaidCents, remainderAmountCents, agreementSigned, payRemainderUrl }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Welcome to CHEW — Enrollment Confirmed',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Welcome to CHEW, ${name || 'there'}.</h2>
        <p>Payment confirmed. Your move is officially in motion.</p>
        <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:14px;">
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold; width:150px;">Program</td><td style="padding:6px 0;">${programLabel}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Payment Received</td><td style="padding:6px 0;">${formatCents(amountPaidCents)} (entry fee)</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Agreement</td><td style="padding:6px 0;">${agreementSigned ? 'Signed' : 'Not on file'}</td></tr>
        </table>
        <p>The remaining balance of <strong>${formatCents(remainderAmountCents)}</strong> is credited from
        your entry fee against the program's full cost.</p>
        <p><strong>What happens next:</strong> when you're ready, you can pay the remainder in full by card
        (and receive a complimentary 1:1 strategy session as our thank-you — not a discount), or split it via
        Klarna or Afterpay:</p>
        <p><a href="${payRemainderUrl}" style="color: #8F7024; font-weight: bold;">Pay your remaining balance</a></p>
        <p>Questions? Just reply to this email.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

async function sendMembershipWelcomeEmail({ to, name, amountPaidCents, agreementSigned, firstChargeDate }) {
  const resend = getClient();

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Welcome to CHEW — Enrollment Confirmed',
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Welcome to CHEW, ${name || 'there'}.</h2>
        <p>Payment confirmed. Your move is officially in motion.</p>
        <table style="width:100%; border-collapse:collapse; margin:20px 0; font-size:14px;">
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold; width:150px;">Program</td><td style="padding:6px 0;">Membership</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Payment Received</td><td style="padding:6px 0;">${formatCents(amountPaidCents)} (entry fee)</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Agreement</td><td style="padding:6px 0;">${agreementSigned ? 'Signed' : 'Not on file'}</td></tr>
        </table>
        <p><strong>What happens next:</strong> your $97/month membership begins on
        <strong>${formatDate(firstChargeDate)}</strong> — nothing further is due before then. We'll send a
        reminder a week before your first charge, with an easy way to cancel any time.</p>
        <p>Questions? Just reply to this email.</p>
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

// Sent to CHEW's operations inbox the moment a signature is durably
// recorded — never gated on payment (a client may sign and never pay;
// CHEW still needs the record). Contains the exact agreement text the
// client saw (agreementHtml, from agreement_signatures.agreement_snapshot_html),
// not just "someone signed something." No IP, user agent, database ids,
// access tokens, or admin secret — those stay in the evidence tables, not
// in an email body.
async function sendOwnerSignedAgreementNotice({ fullName, email, phone, program, agreementVersion, signedAt, agreementHtml }) {
  const resend = getClient();

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to: getAdminEmail(),
    subject: `Signed CHEW Agreement — ${fullName} — ${program}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Agreement signed.</h2>
        <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold; width:170px;">Client</td><td style="padding:6px 0;">${escapeHtml(fullName)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Contact</td><td style="padding:6px 0;">${escapeHtml(email)}${phone ? ' &middot; ' + escapeHtml(phone) : ''}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Program</td><td style="padding:6px 0;">${escapeHtml(program)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Agreement Version</td><td style="padding:6px 0;">${escapeHtml(agreementVersion)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Signed</td><td style="padding:6px 0;">${new Date(signedAt).toLocaleString()}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Signature Status</td><td style="padding:6px 0;">Recorded</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Payment Status</td><td style="padding:6px 0;">Not yet completed</td></tr>
        </table>
        <p style="font-weight:bold;">Signing the agreement does not mean payment has been completed. A separate enrollment notice will follow if and when Stripe confirms payment.</p>
        <hr style="border:none; border-top:1px solid #ddd; margin:24px 0;">
        <p style="font-size:13px; color:#666; text-transform:uppercase; letter-spacing:0.04em;">Exact agreement text signed</p>
        <div style="font-size:14px;">${agreementHtml}</div>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">Internal notice — CHEW Admissions</p>
      </div>
    `,
  });
}

// Sent to the client the moment their signature is durably recorded — a
// retained copy is a professional courtesy, not something to withhold
// until they've paid. Contains the exact same signed text as the owner
// copy above.
async function sendClientSignedAgreementCopyEmail({ to, name, program, agreementVersion, signedAt, agreementHtml }) {
  const resend = getClient();

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: 'Your CHEW Agreement Has Been Signed',
    html: `
      <div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Your CHEW agreement has been signed, ${name || 'there'}.</h2>
        <p>This email is your copy of the exact CHEW LLC Client Services Agreement (${escapeHtml(program)}, version ${escapeHtml(agreementVersion)}) you signed on ${new Date(signedAt).toLocaleString()}. Keep it for your records.</p>
        <p>Signing this agreement does not mean payment has been completed — you'll see your Deal Sheet next, and nothing is charged until you confirm payment through Stripe's secure checkout.</p>
        <hr style="border:none; border-top:1px solid #ddd; margin:24px 0;">
        <div style="font-size:14px;">${agreementHtml}</div>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

// Customer-facing payment-plan notice — one function covers both the
// initial payment (isInitial: true) and every subsequent installment,
// since the content difference is just which numbers apply. Never implies
// payment is complete when it isn't (remainingBalanceCents / next payment
// date are only included while the plan isn't finished).
async function sendPlanPaymentReceivedEmail({ to, name, tier, amountPaidCents, isInitial, installmentNumber, installmentCount, remainingBalanceCents, nextPaymentDate }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;
  const heading = isInitial ? `Payment received, ${name || 'there'}.` : `Installment payment received, ${name || 'there'}.`;
  const progressLine = isInitial
    ? `This was your initial payment on the ${escapeHtml(programLabel)} Monthly Plan.`
    : `This was installment ${escapeHtml(installmentNumber)} of ${escapeHtml(installmentCount)} on your ${escapeHtml(programLabel)} Monthly Plan.`;
  const remainingLine = remainingBalanceCents > 0
    ? `<p>Remaining balance: <strong>${formatCents(remainingBalanceCents)}</strong>. Your next payment is scheduled for ${nextPaymentDate ? new Date(nextPaymentDate).toLocaleDateString() : 'next month'}, billed automatically to the payment method on file.</p>`
    : '';

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: isInitial ? `Payment Received — ${programLabel}` : `Installment Payment Received — ${programLabel}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">${heading}</h2>
        <p>${progressLine}</p>
        <p>Amount received: <strong>${formatCents(amountPaidCents)}</strong>.</p>
        ${remainingLine}
        <p>Questions? Just reply to this email.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

// Customer-facing failed-installment notice. Calm, factual, no threats —
// explains what happens next (automatic retry, then a grace period)
// rather than demanding immediate action.
async function sendPlanPaymentFailedEmail({ to, name, tier, amountDueCents }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: `Payment Issue — ${programLabel}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">A payment didn't go through, ${name || 'there'}.</h2>
        <p>Your ${escapeHtml(programLabel)} Monthly Plan installment of <strong>${formatCents(amountDueCents)}</strong> could not be charged to the payment method on file.</p>
        <p>Stripe will automatically retry the charge. If it's still unresolved after a short grace period, your session delivery and Client Portal access may be paused until the balance is cured, per your signed agreement — nothing is deleted, and you won't be charged twice for the same installment.</p>
        <p>To avoid any interruption, you can update your payment method by replying to this email.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

// Customer-facing paid-in-full notice — fires once, either immediately
// (Pay in Full) or after the final Monthly Plan installment clears.
async function sendPlanPaidInFullEmail({ to, name, tier }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to,
    subject: `${programLabel} — Paid in Full`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">You're paid in full, ${name || 'there'}.</h2>
        <p>Your ${escapeHtml(programLabel)} engagement is now paid in full. We're glad to have you.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">CHEW LLC &mdash; Creating Honest Economic Wealth</p>
      </div>
    `,
  });
}

// Owner-facing escalation for an unresolved payment-plan failure —
// separate from sendOwnerEnrollmentNotice (which covers successful
// payment events) because this one needs to read as an alert, not a
// routine notice.
async function sendOwnerPlanPaymentFailedNotice({ purchaseId, fullName, email, tier, amountDueCents }) {
  const resend = getClient();
  const programLabel = PROGRAM_LABELS[tier] || tier;

  return resend.emails.send({
    from: process.env.FROM_EMAIL || 'CHEW <admissions@joinchew.com>',
    to: getAdminEmail(),
    subject: `Payment Failed — ${fullName} — ${programLabel}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color: #1B1815;">
        <h2 style="color: #8F7024;">Installment payment failed.</h2>
        <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold; width:150px;">Client</td><td style="padding:6px 0;">${escapeHtml(fullName)} (${escapeHtml(email)})</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Program</td><td style="padding:6px 0;">${escapeHtml(programLabel)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Amount Due</td><td style="padding:6px 0;">${formatCents(amountDueCents)}</td></tr>
          <tr><td style="padding:6px 0; color:#8F7024; font-weight:bold;">Purchase ID</td><td style="padding:6px 0;">#${escapeHtml(purchaseId)} (internal)</td></tr>
        </table>
        <p>Stripe is retrying automatically. If unresolved after the grace period, service access pauses per the signed agreement.</p>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">Internal notice — CHEW Admissions</p>
      </div>
    `,
  });
}

module.exports = {
  answerLabel,
  sendConfirmationEmail,
  sendReminderEmail,
  sendStartingPositionConfirmationEmail,
  sendOwnerNewApplicationNotice,
  sendDecisionEmail,
  sendRecommendationReadyEmail,
  sendScopeReviewRequestNotice,
  sendRecommendationNotViewedReminderEmail,
  sendChooseEngagementReminderEmail,
  sendSignAgreementReminderEmail,
  sendProgramEntryConfirmationEmail,
  sendMembershipWelcomeEmail,
  sendRemainderConfirmationEmail,
  sendAdminBonusSessionNotice,
  sendPlanPaymentReceivedEmail,
  sendPlanPaymentFailedEmail,
  sendPlanPaidInFullEmail,
  sendOwnerPlanPaymentFailedNotice,
  sendOwnerEnrollmentNotice,
  sendMembershipReminderEmail,
  sendOwnerSignedAgreementNotice,
  sendClientSignedAgreementCopyEmail,
  TIER_LABELS,
};
