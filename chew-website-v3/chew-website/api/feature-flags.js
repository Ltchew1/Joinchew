// /api/feature-flags.js
//
// The single source of truth the homepage's "What's Next" cards read
// from — no card is hard-coded per page. A row is only ever returned
// here if public_teaser_enabled = TRUE in the database (checked by
// lib/featureFlags.getPublicFlags, not by this handler), so an
// 'internal' feature is invisible even if someone adds its slug to the
// allowlist below by mistake. Each card's title/description/status
// switches "Coming Soon" to "Explore" automatically once status reaches
// 'preview'/'beta'/'live' — no redesign or deploy needed. This is not
// the enforcement point — each real feature's own API checks
// lib/featureFlags.js itself; this just drives the marketing UI.
//
// GET /api/feature-flags

const { getPublicFlags } = require('../lib/featureFlags');

// Fixed allowlist — do not make this dynamic/unbounded. Only slugs that
// are meant to ever be publicly visible as a UI state belong here; the
// database's public_teaser_enabled flag still has final say per-row.
const PUBLIC_FLAG_SLUGS = [
  'path_engine',
  'capability_network',
  'business_intelligence_suite',
  'education_careers',
  'asset_intelligence',
  'chew_connections_suite',
];

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const flags = await getPublicFlags(PUBLIC_FLAG_SLUGS);
    return res.status(200).json({ flags });
  } catch (err) {
    console.error('feature-flags error:', err.message);
    return res.status(500).json({ error: 'Unable to load feature flags.' });
  }
};
