// lib/programs.js
//
// Shared tier definitions for the post-acceptance program-purchase flow.
// Amounts are hardcoded business terms (not configurable per-request).
// Entry and membership-recurring amounts are charged via real Stripe Price
// ids (env vars below); the remainder balance (full fee minus entry, e.g.
// $1,997 - $297 = $1,700) has no separate Price object and is charged via
// inline price_data in api/create-remainder-checkout-session.js instead —
// so remainderAmountCents is the only remainder-related field needed here.

const PROGRAMS = {
  infrastructure: {
    label: 'Infrastructure Program',
    entryPriceEnv: 'STRIPE_PRICE_INFRASTRUCTURE_ENTRY',
    entryAmountCents: 29700,
    fullFeeCents: 199700,
    remainderAmountCents: 170000, // $1,997 - $297
    hasRemainder: true,
  },
  executive: {
    label: 'Executive Advisory',
    entryPriceEnv: 'STRIPE_PRICE_EXECUTIVE_ENTRY',
    entryAmountCents: 59700,
    fullFeeCents: 499700,
    remainderAmountCents: 440000, // $4,997 - $597
    hasRemainder: true,
  },
  membership: {
    label: 'Membership',
    entryPriceEnv: 'STRIPE_PRICE_MEMBERSHIP_ENTRY',
    entryAmountCents: 14700,
    recurringPriceEnv: 'STRIPE_PRICE_MEMBERSHIP_RECURRING',
    recurringAmountCents: 9700,
    trialPeriodDays: 30,
    hasRemainder: false,
  },
};

function getProgram(tier) {
  const program = PROGRAMS[tier];
  if (!program) throw new Error(`Unknown program tier: ${tier}`);
  return program;
}

module.exports = { PROGRAMS, getProgram };
