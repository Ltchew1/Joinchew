// /api/debug-check-tables.js
//
// TEMPORARY diagnostic endpoint — delete after tonight's schema verification
// is confirmed. Connects via DATABASE_URL_UNPOOLED (the direct, non-pooled
// connection) and lists every table in the public schema. This is ground
// truth from the actual running deployment, bypassing any dashboard GUI
// caching that made the Vercel/Neon Schema and Data Editor panels
// disagree with each other earlier tonight.
//
// GET /api/debug-check-tables?token=<TEMP_DEBUG_TOKEN>

const { Client } = require('pg');

const TEMP_DEBUG_TOKEN = 'chew-schema-check-2026-temp';

module.exports = async (req, res) => {
  if (req.query.token !== TEMP_DEBUG_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
    );
    return res.status(200).json({
      connectedVia: 'DATABASE_URL_UNPOOLED',
      tableCount: result.rows.length,
      tables: result.rows.map((r) => r.table_name),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    await client.end();
  }
};
