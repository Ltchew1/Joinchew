// /api/admin-applications.js
//
// Lightweight admissions review queue — no real auth system exists yet
// (the built-out Admin Dashboard is a later phase), so this follows the
// same shared-secret convention already used by api/send-reminders.js.
// Requires ADMIN_SECRET and DATABASE_URL set in Vercel environment variables.
//
// GET /api/admin-applications?secret=<ADMIN_SECRET>

const { query } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ADMIN_SECRET) {
    return res.status(503).json({ error: 'Admin access is not configured yet.' });
  }
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await query(
      `SELECT id, full_name, email, phone, answers,
              ai_score, ai_dimension_scores, ai_recommendation, ai_conditions,
              ai_rationale, ai_one_flag, ai_one_strength, ai_error,
              status, decision, decision_note, decided_at, created_at
       FROM applications
       ORDER BY (status = 'decided') ASC, created_at DESC`
    );
    return res.status(200).json({ applications: result.rows });
  } catch (err) {
    console.error('admin-applications error:', err.message);
    return res.status(500).json({ error: 'Unable to load applications.' });
  }
};
