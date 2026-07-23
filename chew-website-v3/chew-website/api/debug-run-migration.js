// /api/debug-run-migration.js
//
// TEMPORARY diagnostic endpoint — delete after tonight's schema migration
// is confirmed applied. Reads db/schema.sql, connects via
// DATABASE_URL_UNPOOLED (direct, non-pooled — avoids the "cannot insert
// multiple commands into a prepared statement" error Neon's own web SQL
// editor hit, which happens under pooled/extended-protocol connections),
// splits the file into individual statements, and runs them ONE AT A TIME,
// logging success or failure per statement rather than batching.
//
// GET /api/debug-run-migration?token=<TEMP_DEBUG_TOKEN>

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const TEMP_DEBUG_TOKEN = 'chew-schema-check-2026-temp';

function splitStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);
}

module.exports = async (req, res) => {
  if (req.query.token !== TEMP_DEBUG_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let sql;
  try {
    sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  } catch (err) {
    return res.status(500).json({ error: `Could not read db/schema.sql: ${err.message}` });
  }

  const statements = splitStatements(sql);
  const client = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    ssl: { rejectUnauthorized: false },
  });

  const log = [];
  try {
    await client.connect();

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.replace(/\s+/g, ' ').slice(0, 80);
      try {
        await client.query(statement);
        log.push({ index: i, status: 'success', preview });
      } catch (err) {
        log.push({ index: i, status: 'failed', preview, error: err.message });
      }
    }

    return res.status(200).json({
      connectedVia: 'DATABASE_URL_UNPOOLED',
      totalStatements: statements.length,
      succeeded: log.filter((l) => l.status === 'success').length,
      failed: log.filter((l) => l.status === 'failed').length,
      log,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  } finally {
    await client.end();
  }
};
