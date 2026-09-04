// lib/agreementRegistry.js
//
// Contract Intelligence Engine foundation. Associates each program tier
// with the agreement type/version/required acknowledgments actually
// governing it today, and exposes the real commercial-terms data (scope,
// exclusions, cancellation, refund, payment options) that the CHEW Deal
// Sheet and Legal & Permissions Vault both need to display.
//
// The commercial-terms strings themselves live in lib/agreementText.js —
// the single canonical source the full agreement body, this registry, and
// sign-agreement.html's "Key terms at a glance" box all read from.
//
// Today all five tiers share one agreement (one AGREEMENT_VERSION). That
// reflects the actual current business, not a hardcoded assumption — a
// future tier/jurisdiction/product can register its own entry here without
// touching the pages or APIs that read this registry.

const { AGREEMENT_VERSION } = require('./agreement');
const { getProgram, isOneTimeTier } = require('./programs');
const { SCOPE: TIER_SCOPE, DOES_NOT_PROMISE, REFUND: REFUND_TEXT, CANCELLATION: CANCELLATION_TEXT, NEXT_STEP: NEXT_STEP_TEXT } = require('./agreementText');

const ONE_TIME_RECORD = {
  agreementType: 'client_services_agreement',
  agreementLabel: 'CHEW LLC Client Services Agreement',
  agreementVersion: AGREEMENT_VERSION,
  transactionType: 'one_time_or_monthly_plan',
  requiredAcknowledgments: ['agreement_read_and_accepted', 'electronic_signature_consent'],
};

const AGREEMENT_REGISTRY = {
  focused_builder: ONE_TIME_RECORD,
  infrastructure: ONE_TIME_RECORD,
  advanced_infrastructure: ONE_TIME_RECORD,
  executive: ONE_TIME_RECORD,
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
  const oneTime = isOneTimeTier(tier);

  return {
    tier,
    label: program.label,
    oneTime,
    // One-time engagement fields (Pay in Full / Monthly Plan)
    totalCents: oneTime ? program.totalCents : null,
    monthly: oneTime ? program.monthly : null,
    durationDays: oneTime ? program.durationDays : null,
    sessionCount: oneTime ? program.sessionCount : null,
    sessionMinutes: oneTime ? program.sessionMinutes : null,
    documentReviewEvents: oneTime ? program.documentReviewEvents : null,
    // The concrete, named work product for this tier (e.g. "Full Financial
    // Blueprint + Position Map + Sequenced Action Plan") — already the
    // source `scope` below is built from, broken out here as its own field
    // so a card UI (select-program.html) can show it as a scannable line
    // rather than only inside the long legal-style `scope` sentence.
    deliverable: oneTime ? program.deliverable : null,
    advisoryAccess: oneTime ? program.advisoryAccess : null,
    // Membership fields (unchanged shape)
    entryAmountCents: !oneTime ? program.entryAmountCents : null,
    recurringAmountCents: !oneTime ? program.recurringAmountCents : null,
    trialPeriodDays: !oneTime ? program.trialPeriodDays : null,
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
