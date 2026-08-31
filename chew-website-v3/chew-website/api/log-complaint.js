// /api/log-complaint.js
//
// Complaint Intelligence foundation — records one complaint/support issue
// into the complaints table (see db/schema.sql) with a consistent category.
// Admin-secret gated, matching the convention already used by
// api/admin-applications.js — no real auth system exists yet. No public
// submission form calls this yet; it exists so a complaint received by
// email (or a future intake form) can be logged consistently rather than
// living only in an inbox. This is intentionally the smallest useful
// piece: log + categorize. Reporting/aggregation is not built here.
//
// POST /api/log-complaint?secret=<ADMIN_SECRET>
// body: { applicationId?, email?, category, description }

const { query } = require('../lib/db');

const VALID_CATEGORIES = [
  'billing_confusion', 'expectation_mismatch', 'service_delay',
  'access_issue', 'data_concern', 'privacy_concern',
  'product_malfunction', 'refund_request',
  'credit_intelligence_concern', 'third_party_issue',
  'communication_issue', 'other',
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ADMIN_SECRET) {
    return res.status(503).json({ error: 'Admin access is not configured yet.' });
  }
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { applicationId, email, category, description } = req.body || {};
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid or missing category.' });
    }
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'Missing description.' });
    }

    const result = await query(
      `INSERT INTO complaints (application_id, email, category, description)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [applicationId || null, email || null, category, String(description).trim()]
    );

    return res.status(200).json({ id: result.rows[0].id, createdAt: result.rows[0].created_at });
  } catch (err) {
    console.error('log-complaint error:', err.message);
    return res.status(500).json({ error: 'Unable to log complaint.' });
  }
};
