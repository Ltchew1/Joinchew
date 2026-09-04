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
// POST /api/request-scope-review { token, message }

const { query } = require('../lib/db');
const { getActiveSentRecommendation } = require('../lib/recommendations');
const { sendScopeReviewRequestNotice } = require('../lib/email');
const { PROGRAMS } = require('../lib/programs');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, message } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing application token.' });

  try {
    const appResult = await query(
      `SELECT id, full_name, email FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const recommendation = await getActiveSentRecommendation(application.id);
    if (!recommendation) {
      return res.status(404).json({ error: 'A scope review can only be requested once you have a CHEW recommendation.' });
    }

    const cleanMessage = message ? String(message).trim().slice(0, 2000) : null;

    await query(
      `UPDATE engagement_recommendations
       SET scope_review_requested_at = now(), scope_review_message = $1
       WHERE id = $2`,
      [cleanMessage, recommendation.id]
    );

    try {
      await sendScopeReviewRequestNotice({
        applicantName: application.full_name,
        applicantEmail: application.email,
        engagementLabel: PROGRAMS[recommendation.primary_tier].label,
        message: cleanMessage,
        adminApplicationUrl: `${process.env.SITE_URL}/admin-applications.html#app-${application.id}`,
      });
    } catch (emailErr) {
      console.error(`SCOPE_REVIEW_NOTICE_FAILED recommendation=${recommendation.id}:`, emailErr.message);
    }

    return res.status(200).json({ requested: true });
  } catch (err) {
    console.error('request-scope-review error:', err.message);
    return res.status(500).json({ error: 'Unable to request a scope review.' });
  }
};
