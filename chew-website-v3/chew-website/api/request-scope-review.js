// /api/request-scope-review.js
//
// "I think I need less/more, my circumstances changed, I have a question"
// — available only once a SENT recommendation exists (there is nothing to
// review before that). Binds to the application's CURRENT active
// recommendation id/version, records the request, notifies CHEW admin,
// and changes nothing else: no new application, no recommendation
// content change, no deletion. Admin decides afterward whether to keep
// the recommendation unchanged or issue a new version via
// api/save-recommendation.js.
//
// Notification durability (same claim-before-send doctrine as
// api/save-recommendation.js's recommendation-ready email --
// scope_review_owner_notified_at, distinct from the scope_review_requested_at
// DB fact): the persisted request always survives an email-provider
// failure, and a retry never re-persists a "new" request nor double-sends
// the admin notice. Three cases, distinguished by current row state:
//   1. No request pending yet (scope_review_requested_at IS NULL) -- a
//      genuinely new request: persist content, notified_at starts NULL.
//   2. A request is pending notification (requested_at set,
//      owner_notified_at still NULL) -- this call is just a retry of the
//      SAME still-undelivered request; content is left untouched and only
//      the notification is attempted again.
//   3. A prior request was already delivered to CHEW (owner_notified_at
//      set) -- this is a genuinely new ask; content is replaced and
//      notified_at resets so CHEW is notified about the new one too.
//
// POST /api/request-scope-review { token, message }

const { getPool } = require('../lib/db');
const { getActiveSentRecommendation, claimAndSendRecommendationNotification } = require('../lib/recommendations');
const { sendScopeReviewRequestNotice } = require('../lib/email');
const { PROGRAMS } = require('../lib/programs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, message } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing application token.' });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const appResult = await client.query(
      `SELECT id, full_name, email FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found.' });
    }

    const recommendation = await getActiveSentRecommendation(application.id);
    if (!recommendation) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'A scope review can only be requested once you have a CHEW recommendation.' });
    }

    const cleanMessage = message ? String(message).trim().slice(0, 2000) : null;
    const isFreshAsk = !recommendation.scope_review_requested_at || !!recommendation.scope_review_owner_notified_at;

    if (isFreshAsk) {
      await client.query(
        `UPDATE engagement_recommendations
         SET scope_review_requested_at = now(), scope_review_message = $1, scope_review_owner_notified_at = NULL
         WHERE id = $2`,
        [cleanMessage, recommendation.id]
      );
    }
    // else: a request is already persisted and still awaiting notification
    // -- this call changes nothing about it, only the send below is retried.

    await client.query('COMMIT');

    try {
      await claimAndSendRecommendationNotification(recommendation.id, 'scope_review_owner_notified_at', () => sendScopeReviewRequestNotice({
        applicantName: application.full_name,
        applicantEmail: application.email,
        engagementLabel: PROGRAMS[recommendation.primary_tier].label,
        message: isFreshAsk ? cleanMessage : recommendation.scope_review_message,
        adminApplicationUrl: `${process.env.SITE_URL}/admin-applications.html#app-${application.id}`,
      }));
    } catch (emailErr) {
      console.error(`SCOPE_REVIEW_NOTICE_FAILED recommendation=${recommendation.id}:`, emailErr.message);
    }

    return res.status(200).json({ requested: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('request-scope-review error:', err.message);
    return res.status(500).json({ error: 'Unable to request a scope review.' });
  } finally {
    client.release();
  }
};
