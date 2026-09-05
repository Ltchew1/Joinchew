// /api/recommendation-viewed.js
//
// Claims the "recommendation actually viewed" fact — called by
// recommendation.html AFTER it successfully renders (never as a GET side
// effect, see api/recommendation.js). Idempotent: sets viewed_at only if
// still null, same claim-once doctrine used everywhere else in this
// codebase (WHERE ... IS NULL), so a page reload or duplicate call never
// overwrites the true first-viewed timestamp.
//
// PATCH /api/recommendation-viewed { token }

const { query } = require('../lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'PATCH' && req.method !== 'POST') {
    res.setHeader('Allow', 'PATCH, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing application token.' });

  try {
    const appResult = await query(`SELECT id FROM applications WHERE access_token = $1`, [token]);
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    const result = await query(
      `UPDATE engagement_recommendations SET viewed_at = now()
       WHERE application_id = $1 AND status = 'sent' AND viewed_at IS NULL
       RETURNING id`,
      [application.id]
    );

    return res.status(200).json({ claimed: result.rowCount > 0 });
  } catch (err) {
    console.error('recommendation-viewed error:', err.message);
    return res.status(500).json({ error: 'Unable to record view.' });
  }
};
