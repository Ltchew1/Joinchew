// lib/db.js
// Shared Postgres connection pool for all serverless functions.
// Requires DATABASE_URL set in Vercel environment variables — a standard
// Postgres connection string from Vercel Postgres, Supabase, or similar.

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set.');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required by most managed Postgres providers
      max: 5, // serverless functions should keep connection counts modest
    });
  }
  return pool;
}

async function query(text, params) {
  const client = getPool();
  return client.query(text, params);
}

// Generic claim-before-send: lock the row, check the given column is
// still NULL, run sendFn(), and only THEN mark it sent — one transaction.
// If sendFn() throws, the rollback leaves the column NULL, so a retry is
// always safe and never double-sends. Same guarantee as
// claimAndSendRecommendationNotification in lib/recommendations.js,
// generalized here so any table can reuse it instead of each call site
// hand-rolling its own version. table/idColumn/column are always literal
// call-site constants in this codebase, never derived from request input.
async function claimAndSend(table, idColumn, id, column, sendFn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT ${column} AS claimed FROM ${table} WHERE ${idColumn} = $1 FOR UPDATE`,
      [id]
    );
    const row = result.rows[0];
    if (!row || row.claimed) {
      await client.query('ROLLBACK');
      return false;
    }

    await sendFn();

    await client.query(`UPDATE ${table} SET ${column} = now() WHERE ${idColumn} = $1`, [id]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, getPool, claimAndSend };
