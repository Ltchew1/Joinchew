// /api/application-summary.js
//
// Minimal read-only lookup by access token, used by sign-agreement.html to
// prefill the applicant's name before they type it to sign. Exposes nothing
// beyond what create-program-checkout-session.js already trusts this same
// token to unlock (full_name/email + accepted status).
//
// GET /api/application-summary?token=<access_token>

const { query } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  try {
    const result = await query(
      `SELECT full_name, decision FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = result.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    if (!['ACCEPT', 'ACCEPT_WITH_CONDITIONS'].includes(application.decision)) {
      return res.status(403).json({ error: 'This application has not been accepted.' });
    }
    return res.status(200).json({ fullName: application.full_name });
  } catch (err) {
    console.error('application-summary error:', err.message);
    return res.status(500).json({ error: 'Unable to load application.' });
  }
};
