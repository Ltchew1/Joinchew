// /api/resend-scope-review-notification.js
//
// Admin-triggered retry for the scope-review request notice when the
// first attempt failed. The client's own "Request a Scope Review" button
// in recommendation.html disables itself permanently after a 200 response
// — which fires whether or not the admin email actually went out (email
// failure is swallowed there, same convention as everywhere else in this
// codebase) — so the client has no path to retry a silently-failed
// notification themselves. This is that path, for CHEW's side instead.
//
// Deliberately does NOT touch scope_review_requested_at/scope_review_message
// — it only ever retries the notification for whatever request is
// currently persisted, and is a safe no-op if it was already delivered.
//
// POST /api/resend-scope-review-notification
//   Authorization: Bearer <Clerk session token>
//   { applicationId }

const { query } = require('../lib/db');
const { PROGRAMS } = require('../lib/programs');
const { requireAdmin } = require('../lib/admin-auth');
const { sendScopeReviewRequestNotice } = require('../lib/email');
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
    if (!recommendation.scope_review_requested_at) {
      return res.status(404).json({ error: 'No scope review has been requested for this recommendation.' });
    }

    if (recommendation.scope_review_owner_notified_at) {
      return res.status(200).json({ alreadyNotified: true, notifiedAt: recommendation.scope_review_owner_notified_at });
    }

    const appInfo = await query(`SELECT full_name, email FROM applications WHERE id = $1`, [applicationId]);
    const sent = await claimAndSendRecommendationNotification(recommendation.id, 'scope_review_owner_notified_at', () => sendScopeReviewRequestNotice({
      applicantName: appInfo.rows[0].full_name,
      applicantEmail: appInfo.rows[0].email,
      engagementLabel: PROGRAMS[recommendation.primary_tier].label,
      message: recommendation.scope_review_message,
      adminApplicationUrl: `${process.env.SITE_URL}/admin-applications.html#app-${applicationId}`,
    }));

    return res.status(200).json({ alreadyNotified: !sent, sent });
  } catch (err) {
    console.error('resend-scope-review-notification error:', err.message);
    return res.status(500).json({ error: 'Unable to resend the notification.' });
  }
};
