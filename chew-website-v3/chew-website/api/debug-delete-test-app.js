// TEMPORARY debug endpoint — deletes the single test application row created
// while verifying the scoring.js fix. Delete this file after use.

const { query } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM applications WHERE id = $1 AND email = $2 RETURNING id`,
      [2, 'scoring-fix-verify@example.com']
    );
    return res.status(200).json({ deletedRows: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
