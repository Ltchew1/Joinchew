// lib/engagementStatus.js
//
// Shared "current entitlement" composition for a single program_purchases
// row — scope, progress, completion, and Continuity state. Factored out of
// api/purchase-status.js so api/my-engagement-status.js (application-token
// scoped, for my-engagement.html) can compose the exact same shape without
// re-deriving the session/document-review counts or the lifecycle-status
// rule a second time. Read-only; never mutates state.

const { query } = require('./db');
const { getDealSheetData } = require('./agreementRegistry');
const { PROGRAMS } = require('./programs');
const { isGraduate } = require('./graduateStatus');

async function composePurchaseStatus(purchase) {
  const program = PROGRAMS[purchase.tier];
  let deal = null;
  try { deal = getDealSheetData(purchase.tier); } catch { deal = null; }

  const [sessionsResult, reviewsResult, graduate] = await Promise.all([
    query(`SELECT count(*)::int c FROM program_purchase_sessions WHERE purchase_id = $1`, [purchase.id]),
    query(`SELECT count(*)::int c FROM program_purchase_document_reviews WHERE purchase_id = $1`, [purchase.id]),
    isGraduate(purchase.application_id),
  ]);

  const now = new Date();
  let lifecycleStatus = 'IN_DELIVERY';
  if (purchase.service_completed_at) {
    lifecycleStatus = purchase.continuity_ends_at && new Date(purchase.continuity_ends_at) > now
      ? 'IN_CONTINUITY'
      : 'CONTINUITY_ENDED';
  }

  return {
    purchaseId: purchase.id,
    tier: purchase.tier,
    label: deal ? deal.label : (program ? program.label : purchase.tier),
    deliverable: program ? program.deliverable : null,
    sessionCeiling: program ? program.sessionCount : null,
    sessionsDelivered: sessionsResult.rows[0].c,
    documentReviewCeiling: program ? program.documentReviewEvents : null,
    documentReviewsUsed: reviewsResult.rows[0].c,
    paymentPlanType: purchase.payment_plan_type,
    paymentPlanStatus: purchase.payment_plan_status,
    totalContractAmountCents: purchase.total_contract_amount_cents,
    installmentAmountCents: purchase.installment_amount_cents,
    installmentCount: purchase.installment_count,
    installmentsPaid: purchase.installments_paid,
    paidInFullAt: purchase.paid_in_full_at,
    serviceCompletedAt: purchase.service_completed_at,
    continuityEndsAt: purchase.continuity_ends_at,
    lifecycleStatus,
    membershipEligible: graduate,
  };
}

module.exports = { composePurchaseStatus };
