// /api/admin-recommendation.js
//
// Read side of the Scope Builder: returns the current draft (if one is
// being edited) or, if none, the currently active sent recommendation
// (as a starting point for building the next version) for one
// application, plus its conditions — so admin-applications.html's Scope
// Builder panel can resume an in-progress recommendation rather than
// always starting blank. Kept separate from api/admin-applications.js's
// list query so the main admissions queue doesn't pay for a full
// conditions fetch on every row when only one Scope Builder panel is
// ever open at a time.
//
// GET /api/admin-recommendation?applicationId=<id>
//   Authorization: Bearer <Clerk session token>

const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/admin-auth');
const { getConditionsForRecommendation } = require('../lib/recommendations');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  const applicationId = req.query.applicationId;
  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId.' });

  try {
    const draftResult = await query(
      `SELECT id, application_id, version, status, primary_tier, alternative_tier,
              focus_areas, client_facing_reason, client_facing_summary, alternative_tradeoff,
              recommended_priorities, created_at, sent_at
       FROM engagement_recommendations WHERE application_id = $1 AND status = 'draft'`,
      [applicationId]
    );
    let recommendation = draftResult.rows[0] || null;
    let editingDraft = !!recommendation;

    if (!recommendation) {
      const sentResult = await query(
        `SELECT id, application_id, version, status, primary_tier, alternative_tier,
                focus_areas, client_facing_reason, client_facing_summary, alternative_tradeoff,
                recommended_priorities, created_at, sent_at, viewed_at,
                client_recommendation_notified_at,
                scope_review_requested_at, scope_review_message, scope_review_owner_notified_at
         FROM engagement_recommendations WHERE application_id = $1 AND status = 'sent'`,
        [applicationId]
      );
      recommendation = sentResult.rows[0] || null;
    }

    const conditions = recommendation ? await getConditionsForRecommendation(recommendation.id) : [];

    return res.status(200).json({ recommendation, editingDraft, conditions });
  } catch (err) {
    console.error('admin-recommendation error:', err.message);
    return res.status(500).json({ error: 'Unable to load recommendation.' });
  }
};
