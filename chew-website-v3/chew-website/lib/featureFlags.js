// lib/featureFlags.js
//
// Server-side gate for not-yet-launched features, and the single source
// of truth the homepage reads to render its "What's Next" cards — no
// feature card is hard-coded per page; it's read from this registry.
//
// "Hidden UI is not security" — a feature not at API-accessible status
// must be unreachable at the API layer, not merely unlinked from
// navigation. Callers should treat a false/'not found' result as a real
// 404, not a soft warning.
//
// Fails closed: if the flags table can't be read, or a slug isn't
// registered, the feature is treated as NOT accessible.

const { query } = require('./db');

const API_ACCESSIBLE_STATUSES = ['preview', 'beta', 'live'];

async function getFeatureStatus(slug) {
  try {
    const result = await query('SELECT status FROM feature_flags WHERE slug = $1', [slug]);
    return result.rows[0] ? result.rows[0].status : null;
  } catch (err) {
    console.error('featureFlags lookup failed:', err.message);
    return null;
  }
}

async function isFeatureActive(slug) {
  const status = await getFeatureStatus(slug);
  return API_ACCESSIBLE_STATUSES.includes(status);
}

// Returns only features explicitly approved for public visibility
// (public_teaser_enabled = TRUE), restricted to a fixed allowlist of
// slugs as a defense-in-depth measure — a row with the flag off, or not
// on the allowlist, is never returned, regardless of status.
async function getPublicFlags(allowedSlugs) {
  const result = await query(
    `SELECT slug, status, public_title, public_description, category
     FROM feature_flags
     WHERE public_teaser_enabled = TRUE AND slug = ANY($1::text[])
     ORDER BY id ASC`,
    [allowedSlugs]
  );
  return result.rows.map((row) => ({
    slug: row.slug,
    status: row.status,
    isAccessible: API_ACCESSIBLE_STATUSES.includes(row.status),
    title: row.public_title,
    description: row.public_description,
    category: row.category,
  }));
}

module.exports = { getFeatureStatus, isFeatureActive, getPublicFlags, API_ACCESSIBLE_STATUSES };
