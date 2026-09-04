// lib/agreementRegistry.js
//
// Contract Intelligence Engine foundation. Associates each program tier
// with the agreement type/version/required acknowledgments actually
// governing it today, and exposes the real commercial-terms data (scope,
// exclusions, cancellation, refund) that the CHEW Deal Sheet and Legal &
// Permissions Vault both need to display.
//
// The commercial-terms strings themselves live in lib/agreementText.js —
// the single canonical source the full agreement body, this registry, and
// sign-agreement.html's "Key terms at a glance" box all read from. This
// file used to hand-type its own verbatim copies of those strings (kept
// in sync only by a code comment asking nicely); it now imports them
// instead, so there is exactly one place to change a term, not several
// that have to be remembered together.
//
// Today all three tiers share one agreement (one AGREEMENT_VERSION). That
// reflects the actual current business, not a hardcoded assumption — a
// future tier/jurisdiction/product can register its own entry here without
// touching the pages or APIs that read this registry.

const { AGREEMENT_VERSION } = require('./agreement');
const { getProgram } = require('./programs');
const { SCOPE: TIER_SCOPE, DOES_NOT_PROMISE, REFUND: REFUND_TEXT, CANCELLATION: CANCELLATION_TEXT, NEXT_STEP: NEXT_STEP_TEXT } = require('./agreementText');

const AGREEMENT_REGISTRY = {
  infrastructure: {
    agreementType: 'client_services_agreement',
    agreementLabel: 'CHEW LLC Client Services Agreement',
    agreementVersion: AGREEMENT_VERSION,
    transactionType: 'one_time_plus_balance',
    requiredAcknowledgments: ['agreement_read_and_accepted', 'electronic_signature_consent'],
  },
  executive: {
    agreementType: 'client_services_agreement',
    agreementLabel: 'CHEW LLC Client Services Agreement',
    agreementVersion: AGREEMENT_VERSION,
    transactionType: 'one_time_plus_balance',
    requiredAcknowledgments: ['agreement_read_and_accepted', 'electronic_signature_consent'],
  },
  membership: {
    agreementType: 'client_services_agreement',
    agreementLabel: 'CHEW LLC Client Services Agreement',
    agreementVersion: AGREEMENT_VERSION,
    transactionType: 'recurring_subscription',
    requiredAcknowledgments: ['agreement_read_and_accepted', 'electronic_signature_consent'],
  },
};

function getAgreementRecord(tier) {
  const record = AGREEMENT_REGISTRY[tier];
  if (!record) throw new Error(`No agreement record for tier: ${tier}`);
  return record;
}

function getDealSheetData(tier) {
  const program = getProgram(tier); // throws on unknown tier, same guard used everywhere else
  const agreement = getAgreementRecord(tier);
  return {
    tier,
    label: program.label,
    entryAmountCents: program.entryAmountCents,
    fullFeeCents: program.fullFeeCents || null,
    remainderAmountCents: program.hasRemainder ? program.remainderAmountCents : null,
    hasRemainder: program.hasRemainder,
    recurringAmountCents: program.recurringAmountCents || null,
    trialPeriodDays: program.trialPeriodDays || null,
    scope: TIER_SCOPE[tier],
    doesNotPromise: DOES_NOT_PROMISE,
    refund: REFUND_TEXT[tier],
    cancellation: CANCELLATION_TEXT[tier],
    whatHappensNext: NEXT_STEP_TEXT[tier],
    agreementType: agreement.agreementType,
    agreementLabel: agreement.agreementLabel,
    agreementVersion: agreement.agreementVersion,
    transactionType: agreement.transactionType,
  };
}

module.exports = { AGREEMENT_REGISTRY, getAgreementRecord, getDealSheetData };
