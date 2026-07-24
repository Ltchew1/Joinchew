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

  // TEMPORARY: admin-only test harness for the remainder-payment flow.
  // Creates/cleans up a throwaway pending_remainder purchase row so
  // create-remainder-checkout-session.js can be verified live. Remove once done.
  if (req.query && req.query.remainder_test === process.env.ADMIN_SECRET) {
    const crypto = require('crypto');
    try {
      if (req.query.cleanup === '1') {
        await query(`DELETE FROM program_purchases WHERE access_token = $1`, [req.query.rtoken]);
        return res.status(200).json({ cleaned: true });
      }
      const testToken = crypto.randomUUID();
      const insertResult = await query(
        `INSERT INTO program_purchases
           (access_token, tier, client_name, client_email, entry_amount_cents, remainder_amount_cents, status, entry_paid_at)
         VALUES ($1, 'infrastructure', 'Remainder Test', 'remainder-test@example.com', 29700, 170000, 'pending_remainder', now())
         RETURNING access_token`,
        [testToken]
      );
      return res.status(200).json({ testToken: insertResult.rows[0].access_token });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
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
