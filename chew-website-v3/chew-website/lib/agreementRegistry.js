// lib/agreementRegistry.js
//
// Contract Intelligence Engine foundation. Associates each program tier
// with the agreement type/version/required acknowledgments actually
// governing it today, and centralizes the real commercial-terms strings
// (scope, exclusions, cancellation, refund) that the CHEW Deal Sheet and
// Legal & Permissions Vault both need to display.
//
// This module does not invent new legal terms. Every string below is
// copied verbatim from the governing agreement text already rendered in
// sign-agreement.html (line numbers noted per string so the two stay in
// sync if the agreement is ever amended — see AGREEMENT_VERSION in
// lib/agreement.js, which must be bumped whenever that text changes).
//
// Today all three tiers share one agreement (one AGREEMENT_VERSION). That
// reflects the actual current business, not a hardcoded assumption — a
// future tier/jurisdiction/product can register its own entry here without
// touching the pages or APIs that read this registry.

const { AGREEMENT_VERSION } = require('./agreement');
const { getProgram } = require('./programs');

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

// Verbatim from sign-agreement.html Section 1 (per-tier paragraphs).
const TIER_SCOPE = {
  infrastructure: 'Financial Blueprint Assessment; a defined set of strategy sessions; access to the CHEW Client Portal (Blueprint, Tasks, Documents, Advisor); structured task assignments with strategist verification.',
  executive: 'All Infrastructure Program services, at an elevated cadence and scope, including additional strategy sessions and expanded advisory access, as described in the program materials you reviewed before selecting this tier.',
  membership: 'Ongoing monthly access to the CHEW Client Portal, educational content, and periodic check-ins, billed on a recurring basis after the initial trial period described in the agreement.',
};

// Verbatim from sign-agreement.html Section 2 ("CHEW additionally does not:").
const DOES_NOT_PROMISE = 'CHEW does not guarantee any specific financial outcome, income level, credit score change, loan approval, or funding approval, and does not guarantee that you will qualify for, obtain, or be approved for any specific financing, credit product, or business opportunity discussed during the engagement.';

// Verbatim from sign-agreement.html Section 3.4 (Refunds).
const REFUND_TEXT = {
  infrastructure: 'The entry fee is refundable in full if you request cancellation in writing within 3 business days of payment, provided you have not yet attended a strategy session or received the Financial Blueprint Assessment. Once a strategy session has been delivered or the Financial Blueprint Assessment has been provided, the entry fee is non-refundable. Remainder balance payments are non-refundable once paid, except where required by applicable law.',
  executive: 'The entry fee is refundable in full if you request cancellation in writing within 3 business days of payment, provided you have not yet attended a strategy session or received the Financial Blueprint Assessment. Once a strategy session has been delivered or the Financial Blueprint Assessment has been provided, the entry fee is non-refundable. Remainder balance payments are non-refundable once paid, except where required by applicable law.',
  membership: 'The entry fee is refundable in full if you request cancellation in writing within 3 business days of payment, provided you have not yet attended a strategy session or received the Financial Blueprint Assessment. Once a strategy session has been delivered or the Financial Blueprint Assessment has been provided, the entry fee is non-refundable. Membership fees are non-refundable for any partial month; you may cancel at any time to stop future charges.',
};

// Verbatim from sign-agreement.html Section 5 (Term, Cancellation, and Termination).
const CANCELLATION_TEXT = {
  infrastructure: 'You may cancel at any time by written notice. Refunds, if any, are governed by the refund terms above. Cancelling does not relieve you of a remainder balance already invoiced for services already delivered.',
  executive: 'You may cancel at any time by written notice. Refunds, if any, are governed by the refund terms above. Cancelling does not relieve you of a remainder balance already invoiced for services already delivered.',
  membership: 'You may cancel at any time, effective at the end of the current billing period, through the Client Portal’s billing management or by written notice. There is no early-termination fee.',
};

const NEXT_STEP_TEXT = {
  infrastructure: 'You’ll be redirected to Stripe’s secure checkout to pay your entry fee. The remainder balance is billed separately, later, once you’re ready.',
  executive: 'You’ll be redirected to Stripe’s secure checkout to pay your entry fee. The remainder balance is billed separately, later, once you’re ready.',
  membership: 'You’ll be redirected to Stripe’s secure checkout to pay your entry fee and set up your membership. Your first monthly charge happens automatically after the 30-day trial, unless you cancel first.',
};

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
