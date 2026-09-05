// /api/resend-recommendation-notification.js
//
// Admin-triggered retry for the "Your CHEW Recommendation Is Ready" email
// when the first attempt failed — see api/save-recommendation.js and
// lib/recommendations.js's claimAndSendRecommendationNotification for the
// claim-before-send doctrine this relies on. Deliberately does NOT touch
// recommendation content, version, or sent_at: it only ever attempts the
// notification for the application's CURRENT status='sent' recommendation,
// and only if client_recommendation_notified_at is still NULL. If it's
// already set (a prior call already delivered it), this is a safe no-op —
// never a duplicate send, never a new version.
//
// POST /api/resend-recommendation-notification
//   Authorization: Bearer <Clerk session token>
//   { applicationId }

const { query } = require('../lib/db');
const { PROGRAMS } = require('../lib/programs');
const { requireAdmin } = require('../lib/admin-auth');
const { sendRecommendationReadyEmail } = require('../lib/email');
const { getActiveSentRecommendation, claimAndSendRecommendationNotification } = require('../lib/recommendations');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  const { applicationId } = req.body || {};
  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId.' });

  try {
    const recommendation = await getActiveSentRecommendation(applicationId);
    if (!recommendation) return res.status(404).json({ error: 'No sent recommendation found for this application.' });

    if (recommendation.client_recommendation_notified_at) {
      return res.status(200).json({ alreadyNotified: true, notifiedAt: recommendation.client_recommendation_notified_at });
    }

    const appInfo = await query(`SELECT full_name, email, access_token FROM applications WHERE id = $1`, [applicationId]);
    const sent = await claimAndSendRecommendationNotification(recommendation.id, 'client_recommendation_notified_at', () => sendRecommendationReadyEmail({
      to: appInfo.rows[0].email,
      name: appInfo.rows[0].full_name,
      engagementLabel: PROGRAMS[recommendation.primary_tier].label,
      clientFacingReason: recommendation.client_facing_reason,
      recommendationUrl: `${process.env.SITE_URL}/recommendation.html?token=${encodeURIComponent(appInfo.rows[0].access_token)}`,
    }));

    return res.status(200).json({ alreadyNotified: !sent, sent });
  } catch (err) {
    console.error('resend-recommendation-notification error:', err.message);
    return res.status(500).json({ error: 'Unable to resend the notification.' });
  }
};
