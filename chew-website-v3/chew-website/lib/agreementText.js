// lib/agreementText.js
//
// THE single canonical source for the CHEW LLC Client Services Agreement.
// Previously this text lived only as static inline HTML in
// sign-agreement.html, with lib/agreementRegistry.js separately
// hand-typing verbatim copies of the scope/refund/cancellation/does-not-
// promise language for the Deal Sheet, and sign-agreement.html's own
// "Key terms at a glance" box asserting the same numbers a third time.
// Three places, kept in sync only by developer discipline and a code
// comment asking nicely. That's the exact drift risk this file removes:
// every fact below is defined exactly once, as data, and everything that
// needs to say it (the full agreement body, the Deal Sheet, the Key Terms
// box) reads the same constant.
//
// Bump AGREEMENT_VERSION (lib/agreement.js) any time the text below
// materially changes, so existing signatures stay tied to the version
// they actually saw. api/sign-agreement.js also hashes the exact rendered
// text at signature time — see agreement_content_hash in db/schema.sql —
// so an edit made without a version bump is still detectable after the
// fact, not just discipline-dependent.

const { AGREEMENT_VERSION } = require('./agreement');

const TIER_LABELS = {
  infrastructure: 'Infrastructure Program',
  executive: 'Executive Advisory',
  membership: 'Membership',
};

// Section 1 / Deal Sheet "CHEW provides"
const SCOPE = {
  infrastructure: 'Financial Blueprint Assessment; a defined set of strategy sessions; access to the CHEW Client Portal (Blueprint, Tasks, Documents, Advisor); structured task assignments with strategist verification.',
  executive: 'Everything in the Infrastructure Program, plus additional strategy sessions at an elevated cadence and expanded 1:1 advisory access, as described in the program materials you reviewed before selecting this tier.',
  membership: 'Ongoing monthly access to the CHEW Client Portal, educational content, and periodic check-ins, billed on a recurring basis after the initial trial period described in Section 3.',
};

// Section 2 / Deal Sheet "CHEW does not promise" — identical across tiers
// today (the limits on what CHEW can promise don't change by program), so
// this is one string, not a per-tier map with three copies of the same
// sentence.
const DOES_NOT_PROMISE = 'CHEW does not guarantee any specific financial outcome, income level, credit score change, loan approval, or funding approval, and does not guarantee that you will qualify for, obtain, or be approved for any specific financing, credit product, or business opportunity discussed during the engagement.';

// Section 3.4 / Deal Sheet "Refund"
const REFUND = {
  infrastructure: 'The entry fee is refundable in full if you request cancellation in writing within 3 business days of payment, provided you have not yet attended a strategy session or received the Financial Blueprint Assessment. Once a strategy session has been delivered or the Financial Blueprint Assessment has been provided, the entry fee is non-refundable. Remainder balance payments are non-refundable once paid, except where required by applicable law.',
  executive: 'The entry fee is refundable in full if you request cancellation in writing within 3 business days of payment, provided you have not yet attended a strategy session or received the Financial Blueprint Assessment. Once a strategy session has been delivered or the Financial Blueprint Assessment has been provided, the entry fee is non-refundable. Remainder balance payments are non-refundable once paid, except where required by applicable law.',
  membership: 'The entry fee is refundable in full if you request cancellation in writing within 3 business days of payment, provided you have not yet attended a strategy session or received the Financial Blueprint Assessment. Once a strategy session has been delivered or the Financial Blueprint Assessment has been provided, the entry fee is non-refundable. Membership fees are non-refundable for any partial month; you may cancel at any time to stop future charges.',
};

// Section 5 / Deal Sheet "Cancellation"
const CANCELLATION = {
  infrastructure: 'You may cancel at any time by written notice. Refunds, if any, are governed by the refund terms above. Cancelling does not relieve you of a remainder balance already invoiced for services already delivered.',
  executive: 'You may cancel at any time by written notice. Refunds, if any, are governed by the refund terms above. Cancelling does not relieve you of a remainder balance already invoiced for services already delivered.',
  membership: 'You may cancel at any time, effective at the end of the current billing period, through the Client Portal’s billing management or by written notice. There is no early-termination fee.',
};

// Deal Sheet "What happens next"
const NEXT_STEP = {
  infrastructure: 'You’ll be redirected to Stripe’s secure checkout to pay your entry fee. The remainder balance is billed separately, later, once you’re ready.',
  executive: 'You’ll be redirected to Stripe’s secure checkout to pay your entry fee. The remainder balance is billed separately, later, once you’re ready.',
  membership: 'You’ll be redirected to Stripe’s secure checkout to pay your entry fee and set up your membership. Your first monthly charge happens automatically after the 30-day trial, unless you cancel first.',
};

// The "Key terms at a glance" box. These are the exact same facts as the
// operative sections below (3.4, 4.3, 4.6, 9) — expressed once here, both
// the summary box and the full text pull from this object, so the two can
// never silently drift out of agreement with each other.
const KEY_TERMS = {
  refundWindow: '3 business days',
  rescheduleNotice: '24 hours',
  forfeitureSessions: 2,
  forfeitureDays: 14,
  governingLaw: 'State of Florida',
};

function esc(s) {
  return String(s == null ? '' : s);
}

// Full agreement body, tier-aware. Returns an array of {id, heading, html}
// sections so a renderer can build a table of contents / section nav
// without re-parsing prose. html is trusted, server-authored content (not
// user input) — safe to inject directly.
function getAgreementSections(tier) {
  if (!TIER_LABELS[tier]) throw new Error(`Unknown tier: ${tier}`);

  return [
    {
      id: 'scope',
      heading: '1. Scope of Services',
      html: `
        <p>CHEW provides financial education, strategy, implementation guidance, and accountability support. The specific services you receive depend on the program you selected:</p>
        <p><strong>Infrastructure Program</strong> — ${esc(SCOPE.infrastructure)}</p>
        <p><strong>Executive Advisory</strong> — ${esc(SCOPE.executive)}</p>
        <p><strong>Membership</strong> — ${esc(SCOPE.membership)}</p>
      `,
    },
    {
      id: 'nature',
      heading: '2. Nature of Services; No Credit Services Organization',
      html: `
        <p><strong>Nature of Services; No Credit Services Organization.</strong> CHEW provides financial education, strategy, and accountability coaching only. CHEW is not a &ldquo;credit services organization&rdquo; as defined in section 817.7001, Florida Statutes, and does not, for compensation or otherwise, perform, offer to perform, or represent that it will perform any service to improve a client&rsquo;s credit record, history, or rating, to obtain an extension of credit for a client, or to dispute information on a client&rsquo;s behalf.</p>
        <p>As part of its educational services only, CHEW may teach clients how to review their own consumer credit reports and how to exercise their own rights under the federal Fair Credit Reporting Act, including the right to dispute — directly with the consumer reporting agencies — any item the client, in the client&rsquo;s sole judgment, attests they do not recognize or did not authorize. Any dispute is prepared, signed, and submitted by the client, in the client&rsquo;s own name, as an exercise of the client&rsquo;s own rights. CHEW does not prepare, file, submit, transmit, or communicate any dispute on the client&rsquo;s behalf; does not instruct clients to dispute accurate information; does not advise which specific items to dispute; and does not represent, promise, or guarantee any result, score change, or removal of any item. Accurate information cannot be permanently removed from a consumer credit report. Any compensation paid to CHEW is for education, strategy, and accountability, and not for any credit service.</p>
        <p>CHEW additionally does not:</p>
        <ul>
          <li>${esc(DOES_NOT_PROMISE)}</li>
          <li>Act as a registered investment advisor, certified public accountant, or attorney — nothing provided under this Agreement is investment advice, tax advice, or legal advice.</li>
        </ul>
        <p>Outcomes depend on your individual circumstances, the accuracy of information you provide, your own execution of assigned tasks, and decisions made by third parties (lenders, credit bureaus, business partners) outside CHEW's control.</p>
      `,
    },
    {
      id: 'fees',
      heading: '3. Fees and Payment',
      html: `
        <p><strong>3.1 Entry Fee.</strong> You pay the entry fee for the selected program at the time of signing this Agreement, as quoted at checkout.</p>
        <p><strong>3.2 Remainder Balance (Infrastructure and Executive only).</strong> The balance of the full program fee is due according to the payment option you select at checkout, as a single remaining-balance payment — not an installment plan. Until it's paid in full, CHEW may limit delivery of program components that have not yet been rendered.</p>
        <p><strong>3.3 Membership Recurring Fee.</strong> Membership includes a 30-day trial period beginning today. Unless you cancel before the trial ends, CHEW will begin billing the recurring monthly membership fee automatically at the end of the trial period, and monthly thereafter, until cancelled.</p>
        <p><strong>3.4 Refunds.</strong></p>
        <ul>
          <li>The entry fee is refundable in full if you request cancellation in writing within ${esc(KEY_TERMS.refundWindow)} of payment, provided you have not yet attended a strategy session or received the Financial Blueprint Assessment.</li>
          <li>Once a strategy session has been delivered or the Financial Blueprint Assessment has been provided, the entry fee is non-refundable.</li>
          <li>Remainder balance payments are non-refundable once paid, except where required by applicable law.</li>
          <li>Membership fees are non-refundable for any partial month; you may cancel at any time to stop future charges, per Section 5.</li>
        </ul>
        <p><strong>3.5 Late or Failed Payments.</strong> If a scheduled remainder or membership payment fails, CHEW will notify you and attempt to collect payment. CHEW may suspend portal access and further service delivery until payment is resolved. Continued non-payment beyond 15 days of notice is grounds for termination under Section 5.</p>
      `,
    },
    {
      id: 'obligations',
      heading: '4. Client Obligations and Program Participation',
      html: `
        <p>Your engagement with CHEW is a two-sided commitment. In exchange for the services described in Section 1, you agree to:</p>
        <p><strong>4.1 Honest Disclosure.</strong> Provide accurate and complete information about your financial situation, both during the application process and throughout the engagement.</p>
        <p><strong>4.2 Task Completion.</strong> Complete assigned action items within the timelines set by your strategist. Tasks are tracked in the Client Portal. A task you mark complete is reviewed and verified by CHEW — self-reported completion alone does not constitute program progress.</p>
        <p><strong>4.3 Session Attendance.</strong> Attend scheduled strategy sessions. You may reschedule any session with at least ${esc(KEY_TERMS.rescheduleNotice)}' notice, at no penalty. A session missed without that notice, and not rescheduled within 7 days, is forfeited.</p>
        <p><strong>4.4 Responsiveness.</strong> Respond to strategist communications within a reasonable time. CHEW cannot deliver strategy or verify tasks for a client who cannot be reached.</p>
        <p><strong>4.5 Good-Faith Participation.</strong> Engage with the program honestly and in good faith.</p>
        <p><strong>4.6 Forfeiture of Program Access.</strong> Your spot in the program may be forfeited if: you miss ${esc(KEY_TERMS.forfeitureSessions)} consecutively scheduled sessions without the notice described in 4.3; you are unresponsive to strategist communications for ${esc(KEY_TERMS.forfeitureDays)} consecutive days; you provide materially false information relevant to the strategy being built; or you engage in abusive or harassing conduct toward CHEW staff.</p>
        <p>Before treating a forfeiture condition as triggered, CHEW will make a reasonable attempt to reach you and confirm the situation. If forfeiture is confirmed: your Client Portal access is revoked, no further sessions or deliverables are provided, amounts already paid are not refunded, and any remainder balance already invoiced under an installment plan remains due under the original payment schedule.</p>
      `,
    },
    {
      id: 'term',
      heading: '5. Term, Cancellation, and Termination',
      html: `
        <p><strong>Infrastructure / Executive</strong> — ${esc(CANCELLATION.infrastructure)}</p>
        <p><strong>Membership</strong> — ${esc(CANCELLATION.membership)}</p>
        <p>CHEW may terminate this Agreement immediately upon written notice if your conduct meets the forfeiture conditions in Section 4.6, or if a payment failure is not resolved as described in Section 3.5. On termination for any reason, your Client Portal access ends and CHEW's obligation to deliver further services ends.</p>
      `,
    },
    {
      id: 'confidentiality',
      heading: '6. Confidentiality',
      html: `<p>CHEW will treat the financial and personal information you share as confidential, and will not disclose it to third parties except as needed to deliver the services described in this Agreement, as required by law, or with your consent. Your information will not be sold to third parties.</p>`,
    },
    {
      id: 'no-guarantee',
      heading: '7. No Guarantee of Results',
      html: `<p>Financial strategy and education services carry no guarantee of results. You are solely responsible for decisions you make based on CHEW's guidance, and for the outcome of any application, credit decision, or business decision you pursue.</p>`,
    },
    {
      id: 'liability',
      heading: '8. Limitation of Liability',
      html: `<p>To the fullest extent permitted by law, CHEW's total liability to you arising out of this Agreement is limited to the amount you have paid CHEW under this Agreement in the twelve (12) months preceding the claim. CHEW is not liable for indirect, incidental, or consequential damages.</p>`,
    },
    {
      id: 'dispute',
      heading: '9. Dispute Resolution and Governing Law',
      html: `<p>This Agreement is governed by the laws of the ${esc(KEY_TERMS.governingLaw)}, without regard to its conflict-of-law principles. Any dispute will first be addressed through good-faith negotiation; if unresolved after 30 days, either party may pursue the dispute in the state or federal courts located in Florida.</p>`,
    },
    {
      id: 'general',
      heading: '10. General Provisions',
      html: `
        <p>This Agreement, together with the program materials referenced in Section 1, is the entire agreement between you and CHEW regarding the selected program. CHEW may update this Agreement for future clients at any time; changes do not apply retroactively to your already-signed Agreement without your consent. If any provision is found unenforceable, the remaining provisions remain in full effect. You may not assign this Agreement.</p>
        <p><strong>Electronic Signature.</strong> By checking the box below and typing your full legal name, you consent to sign this Agreement electronically, as permitted under Florida's Uniform Electronic Transaction Act (Fla. Stat. &sect; 668.50). This electronic signature has the same legal effect as a handwritten signature. CHEW retains your typed name, the affirmative checkbox confirmation, the timestamp, an identifier of the exact agreement version and text you were shown, and technical metadata (such as IP address) as evidence of your consent.</p>
      `,
    },
  ];
}

function renderAgreementHtml(tier) {
  return getAgreementSections(tier).map((s) => `<h2>${esc(s.heading)}</h2>${s.html}`).join('\n');
}

module.exports = {
  AGREEMENT_VERSION,
  TIER_LABELS,
  SCOPE,
  DOES_NOT_PROMISE,
  REFUND,
  CANCELLATION,
  NEXT_STEP,
  KEY_TERMS,
  getAgreementSections,
  renderAgreementHtml,
};
