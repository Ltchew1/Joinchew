// /api/recommendation.js
//
// Read-only. Returns the applicant's currently active (status='sent')
// engagement recommendation, its conditions, and the concrete
// deliverable/pricing data for the primary (and, if offered, alternative)
// tier — everything recommendation.html needs in one call. Deliberately
// does NOT mutate viewed_at as a GET side effect (directive: "Keep GET
// read-only. Do NOT mutate viewed_at as an invisible GET side effect.")
// — see api/recommendation-viewed.js for the separate claim call the
// page fires after it successfully renders.
//
// 404 if no recommendation has ever been sent; a draft is never visible
// here regardless of its content, by construction (the query only ever
// looks for status = 'sent').
//
// GET /api/recommendation?token=<application.access_token>

const { query } = require('../lib/db');
const { getDealSheetData } = require('../lib/agreementRegistry');
const { answerLabel } = require('../lib/email');
const { getConditionsForRecommendation, getActiveSelection } = require('../lib/recommendations');

module.exports = async (req, res) => {
  // Every response here is either token-personalized or an error about a
  // token attempt -- never cacheable by a shared cache or browser disk
  // cache (see closeout doctrine: tokenized surfaces are no-store).
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing application token.' });

  try {
    const appResult = await query(
      `SELECT id, full_name, answers, decision FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    if (!['ACCEPT', 'ACCEPT_WITH_CONDITIONS'].includes(application.decision)) {
      return res.status(403).json({ error: 'This application has not been accepted.' });
    }

    const recResult = await query(
      `SELECT id, version, primary_tier, alternative_tier, focus_areas, client_facing_reason,
              client_facing_summary, alternative_tradeoff, recommended_priorities, sent_at, viewed_at
       FROM engagement_recommendations WHERE application_id = $1 AND status = 'sent'`,
      [application.id]
    );
    const recommendation = recResult.rows[0];
    if (!recommendation) {
      return res.status(404).json({
        error: 'CHEW is still reviewing your Starting Position — your recommendation isn’t ready yet.',
        code: 'RECOMMENDATION_NOT_READY',
      });
    }

    const conditions = (await getConditionsForRecommendation(recommendation.id))
      .map((c) => ({ id: c.id, text: c.condition_text, blocking: c.blocking, satisfied: c.satisfied }));
    const hasUnsatisfiedBlocking = conditions.some((c) => c.blocking && !c.satisfied);

    const activeSelection = await getActiveSelection(recommendation.id);

    const primaryDeal = getDealSheetData(recommendation.primary_tier);
    const alternativeDeal = recommendation.alternative_tier ? getDealSheetData(recommendation.alternative_tier) : null;

    const answers = application.answers || {};

    return res.status(200).json({
      recommendationId: recommendation.id,
      version: recommendation.version,
      yourMove: answerLabel('primary_move', answers.primary_move),
      whatChewSees: recommendation.client_facing_summary,
      recommendedPriorities: recommendation.recommended_priorities || [],
      focusAreas: recommendation.focus_areas,
      primaryTier: recommendation.primary_tier,
      primaryDeal,
      alternativeTier: recommendation.alternative_tier,
      alternativeDeal,
      alternativeTradeoff: recommendation.alternative_tradeoff,
      clientFacingReason: recommendation.client_facing_reason,
      conditions,
      hasUnsatisfiedBlocking,
      sentAt: recommendation.sent_at,
      viewedAt: recommendation.viewed_at,
      activeSelection: activeSelection ? {
        selectedTier: activeSelection.selected_tier,
        selectedPaymentPlan: activeSelection.selected_payment_plan,
      } : null,
    });
  } catch (err) {
    console.error('recommendation error:', err.message);
    return res.status(500).json({ error: 'Unable to load your recommendation.' });
  }
};
