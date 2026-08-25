// lib/featureFlags.js
//
// Server-side gate for not-yet-launched features. "Hidden UI is not
// security" — a feature flipped off here must be unreachable at the API
// layer, not merely unlinked from navigation. Callers should treat a
// false/'not found' result as a real 404, not a soft warning.
//
// Fails closed: if the flags table can't be read, or a slug isn't
// registered, the feature is treated as NOT active.

const { query } = require('./db');

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
  return status === 'active';
}

async function getPublicFlags(slugs) {
  const result = await query(
    'SELECT slug, status FROM feature_flags WHERE slug = ANY($1::text[])',
    [slugs]
  );
  const bySlug = {};
  result.rows.forEach((row) => { bySlug[row.slug] = row.status; });
  return slugs.map((slug) => ({ slug, status: bySlug[slug] || 'locked' }));
}

module.exports = { getFeatureStatus, isFeatureActive, getPublicFlags };
