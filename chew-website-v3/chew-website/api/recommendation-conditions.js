// /api/recommendation-conditions.js
//
// The ONLY endpoint that ever writes to recommendation_conditions after a
// recommendation has been sent — and it only ever touches
// satisfied/satisfied_at/satisfied_by. condition_text and blocking are
// never accepted here, which is what makes them immutable post-send in
// practice: there is no code path that can change them once set. A
// substantive change to wording or blocking classification requires a
// new recommendation version via api/save-recommendation.js instead.
//
// PATCH /api/recommendation-conditions
//   Authorization: Bearer <Clerk session token>
//   { conditionId, satisfied: true | false }

const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/admin-auth');

module.exports = async (req, res) => {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  const { conditionId, satisfied } = req.body || {};
  if (!conditionId || typeof satisfied !== 'boolean') {
    return res.status(400).json({ error: 'conditionId and a boolean satisfied value are required.' });
  }

  try {
    const result = await query(
      `UPDATE recommendation_conditions
       SET satisfied = $1, satisfied_at = CASE WHEN $1 THEN now() ELSE NULL END,
           satisfied_by = CASE WHEN $1 THEN $2 ELSE NULL END
       WHERE id = $3
       RETURNING id, recommendation_id, condition_text, blocking, satisfied, satisfied_at, satisfied_by`,
      [satisfied, adminId, conditionId]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Condition not found.' });

    return res.status(200).json({ condition: row });
  } catch (err) {
    console.error('recommendation-conditions error:', err.message);
    return res.status(500).json({ error: 'Unable to update condition.' });
  }
};
