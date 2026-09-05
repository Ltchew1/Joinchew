// lib/recommendations.js
//
// Shared read/check helpers for the CHEW Recommendation Engine, used by
// every API route that needs to know "what is this applicant currently
// approved for" — api/recommendation.js, api/select-engagement.js,
// api/sign-agreement.js, api/create-program-checkout-session.js,
// api/request-scope-review.js, api/admin-applications.js. Centralized
// here so the definition of "active recommendation" and "blocking
// condition" is asked exactly one way everywhere, rather than four
// slightly different SQL strings drifting apart over time.

const { query, getPool } = require('./db');

// The one non-superseded SENT recommendation for an application, if any —
// enforced as at-most-one by idx_engagement_recommendations_one_sent at
// the database level, so this can never legitimately return >1 row.
async function getActiveSentRecommendation(applicationId) {
  const result = await query(
    `SELECT id, application_id, version, status, primary_tier, alternative_tier,
            focus_areas, client_facing_reason, client_facing_summary, alternative_tradeoff,
            recommended_priorities, created_by, created_at, sent_at, viewed_at, superseded_at,
            client_recommendation_notified_at,
            scope_review_requested_at, scope_review_message, scope_review_owner_notified_at
     FROM engagement_recommendations
     WHERE application_id = $1 AND status = 'sent'`,
    [applicationId]
  );
  return result.rows[0] || null;
}

async function getRecommendationById(id) {
  const result = await query(
    `SELECT id, application_id, version, status, primary_tier, alternative_tier,
            focus_areas, client_facing_reason, client_facing_summary, alternative_tradeoff,
            recommended_priorities, created_by, created_at, sent_at, viewed_at, superseded_at,
            client_recommendation_notified_at,
            scope_review_requested_at, scope_review_message, scope_review_owner_notified_at
     FROM engagement_recommendations WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

// Claim-before-send doctrine, same guarantee as claimAndSendNotification in
// api/stripe-webhook.js: lock the row, check the given notification column
// is still NULL, run sendFn(), and only THEN mark it sent — all in one
// transaction. If sendFn() throws, the rollback leaves the column NULL, so
// a later call (a retry, or a subsequent unrelated action that happens to
// pass through here) is always safe to attempt again and can never
// double-send. Returns true if this call actually sent, false if another
// call already claimed it (or it was already sent).
async function claimAndSendRecommendationNotification(recommendationId, column, sendFn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT ${column} AS claimed FROM engagement_recommendations WHERE id = $1 FOR UPDATE`,
      [recommendationId]
    );
    const row = result.rows[0];
    if (!row || row.claimed) {
      await client.query('ROLLBACK');
      return false;
    }

    await sendFn();

    await client.query(`UPDATE engagement_recommendations SET ${column} = now() WHERE id = $1`, [recommendationId]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function getConditionsForRecommendation(recommendationId) {
  const result = await query(
    `SELECT id, condition_text, blocking, satisfied, satisfied_at, satisfied_by, created_at
     FROM recommendation_conditions WHERE recommendation_id = $1 ORDER BY created_at ASC`,
    [recommendationId]
  );
  return result.rows;
}

// True if selecting an engagement or signing must be refused right now —
// any condition marked blocking that hasn't been marked satisfied by an
// admin. The recommendation itself may still be shown to the applicant
// (directive: "may still be visible so the applicant understands the
// path forward" — they just can't proceed into contracting/payment).
async function hasUnsatisfiedBlockingConditions(recommendationId) {
  const result = await query(
    `SELECT 1 FROM recommendation_conditions
     WHERE recommendation_id = $1 AND blocking = TRUE AND satisfied = FALSE LIMIT 1`,
    [recommendationId]
  );
  return result.rows.length > 0;
}

function isTierApproved(recommendation, tier) {
  return tier === recommendation.primary_tier || tier === recommendation.alternative_tier;
}

// The current non-superseded pre-signature selection for a recommendation,
// if any — enforced as at-most-one by idx_engagement_selections_one_active.
async function getActiveSelection(recommendationId) {
  const result = await query(
    `SELECT id, application_id, recommendation_id, recommendation_version, selected_tier,
            selected_at, selected_payment_plan, payment_plan_selected_at, superseded_at, created_at
     FROM engagement_selections WHERE recommendation_id = $1 AND superseded_at IS NULL`,
    [recommendationId]
  );
  return result.rows[0] || null;
}

async function getNextRecommendationVersion(applicationId) {
  const result = await query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM engagement_recommendations WHERE application_id = $1`,
    [applicationId]
  );
  return result.rows[0].next_version;
}

module.exports = {
  getActiveSentRecommendation,
  getRecommendationById,
  getConditionsForRecommendation,
  hasUnsatisfiedBlockingConditions,
  isTierApproved,
  getActiveSelection,
  getNextRecommendationVersion,
  claimAndSendRecommendationNotification,
};
