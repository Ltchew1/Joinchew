// /api/feature-flags.js
//
// Public read of a fixed, safe allowlist of feature statuses, so the
// site's coming-soon UI can switch itself from "Coming Soon" to
// "Explore" when a flag is flipped 'active' — without a redesign or a
// deploy. This endpoint only ever reveals status ('locked' /
// 'coming_soon' / 'active'), never anything about what a feature does
// internally. It is not the enforcement point — each real feature's own
// API checks lib/featureFlags.js itself; this just drives the marketing
// UI's CTA state.
//
// GET /api/feature-flags

const { getPublicFlags } = require('../lib/featureFlags');

// Fixed allowlist — do not make this dynamic/unbounded. Only flags that
// are meant to be publicly visible as a UI state belong here.
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
