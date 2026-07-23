// TEMPORARY debug endpoint — applies the agreement_signatures migration.
// Delete after use.

const { query } = require('../lib/db');

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS agreement_signatures (
    id                 SERIAL PRIMARY KEY,
    application_id     INTEGER NOT NULL REFERENCES applications (id),
    tier               TEXT NOT NULL CHECK (tier IN ('infrastructure', 'executive', 'membership')),
    signed_name        TEXT NOT NULL,
    agreement_version  TEXT NOT NULL,
    ip_address         TEXT,
    user_agent         TEXT,
    signed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agreement_signatures_application ON agreement_signatures (application_id)`,
  `ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS agreement_signature_id INTEGER REFERENCES agreement_signatures (id)`,
];

module.exports = async (req, res) => {
  const results = [];
  try {
    for (const sql of STATEMENTS) {
      await query(sql);
      results.push({ sql: sql.slice(0, 60), ok: true });
    }
    return res.status(200).json({ results });
  } catch (err) {
    results.push({ ok: false, error: err.message });
    return res.status(500).json({ results });
  }
};
