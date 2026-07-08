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

module.exports = { query, getPool };
