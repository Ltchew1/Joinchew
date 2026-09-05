// lib/programs.js
//
// Shared engagement/tier definitions. Amounts and scope limits are
// hardcoded approved business terms (not configurable per-request) —
// see the "BUSINESS DECISIONS APPROVED" commercial architecture pass.
//
// Every one-time engagement (everything except membership) now supports
// two payment options at the SAME total price — paying in full never
// costs more or less than the sum of the monthly plan:
//   payInFull:  one charge for the full amount, today
//   monthly:    an initial payment today, then N equal monthly
//               installments (Stripe Subscription Schedule — see
//               api/create-program-checkout-session.js and
//               api/stripe-webhook.js)
// Payment timing never changes scope, quality, or total price. Program
// installments are a finite schedule, never Membership (a separate,
// ongoing subscription with its own doctrine below).

const PROGRAMS = {
  focused_builder: {
    label: 'Focused Builder',
    entryPriceEnv: 'STRIPE_PRICE_FOCUSED_BUILDER_FULL',
    totalCents: 89700,
    durationDays: 60,
    sessionCount: 2,
    sessionMinutes: 60,
    deliverable: 'Focused Position Map + Action Sequence',
    documentReviewEvents: 1,
    advisoryAccess: 'Limited clarification/logistics between sessions — no ongoing advisory entitlement.',
    responseTarget: null,
    monthly: { initialCents: 29700, installmentCents: 30000, installmentCount: 2 },
  },
  infrastructure: {
    label: 'Infrastructure Program',
    entryPriceEnv: 'STRIPE_PRICE_INFRASTRUCTURE_FULL',
    totalCents: 199700,
    durationDays: 90,
    sessionCount: 4,
    sessionMinutes: 60,
    deliverable: 'Full Financial Blueprint + Position Map + Sequenced Action Plan',
    documentReviewEvents: 2,
    advisoryAccess: 'Limited within-scope advisory between sessions.',
    responseTarget: 'Within 2 business days',
    monthly: { initialCents: 49700, installmentCents: 50000, installmentCount: 3 },
  },
  advanced_infrastructure: {
    label: 'Advanced Infrastructure',
    entryPriceEnv: 'STRIPE_PRICE_ADVANCED_INFRASTRUCTURE_FULL',
    totalCents: 349700,
    durationDays: 120,
    sessionCount: 6,
    sessionMinutes: 60,
    deliverable: 'Advanced Financial Blueprint + integrated personal/business position architecture + decision sequencing + appropriate scenario work',
    documentReviewEvents: 4,
    advisoryAccess: 'Up to 1 substantive within-scope advisory thread per week.',
    responseTarget: 'Within 2 business days',
    monthly: { initialCents: 69700, installmentCents: 70000, installmentCount: 4 },
  },
  executive: {
    label: 'Executive Advisory',
    entryPriceEnv: 'STRIPE_PRICE_EXECUTIVE_FULL',
    totalCents: 499700,
    durationDays: 150,
    sessionCount: 8,
    sessionMinutes: 60,
    deliverable: 'Executive Financial Blueprint + advanced decision architecture + priority strategy sequencing + deeper scenario analysis',
    documentReviewEvents: 6,
    advisoryAccess: 'High access, not unlimited access: up to 2 substantive within-scope advisory threads per week.',
    responseTarget: 'Priority — within 1 business day',
    monthly: { initialCents: 99700, installmentCents: 80000, installmentCount: 5 },
  },
  membership: {
    label: 'Membership',
    entryPriceEnv: 'STRIPE_PRICE_MEMBERSHIP_ENTRY',
    entryAmountCents: 14700,
    recurringPriceEnv: 'STRIPE_PRICE_MEMBERSHIP_RECURRING',
    recurringAmountCents: 9700,
    trialPeriodDays: 30,
    // Locked doctrine: a client who completed a CHEW engagement pays no
    // new entry fee for Membership. Graduate status is now a real,
    // queryable fact (program_purchases.service_completed_at — see
    // db/schema.sql and api/select-membership.js), and reaching this
    // checkout branch at all already requires it (Membership has no
    // non-graduate entry point — see api/select-membership.js and the
    // tier === 'membership' guard in api/create-program-checkout-session.js),
    // so the waiver applies here unconditionally today. The flag stays
    // separate from the access gate rather than being collapsed into it,
    // in case a future non-graduate Membership path is ever approved.
    entryFeeWaivedForGraduates: true,
  },
};

const ONE_TIME_TIERS = ['focused_builder', 'infrastructure', 'advanced_infrastructure', 'executive'];

function getProgram(tier) {
  const program = PROGRAMS[tier];
  if (!program) throw new Error(`Unknown program tier: ${tier}`);
  return program;
}

function isOneTimeTier(tier) {
  return ONE_TIME_TIERS.includes(tier);
}

module.exports = { PROGRAMS, ONE_TIME_TIERS, getProgram, isOneTimeTier };
