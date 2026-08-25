// /api/capability-routing.js
//
// Capability Network lookup. Returns the real, active, ready provider(s)
// for a given capability need — never a fabricated referral. A
// 'coming_soon' or 'hidden' provider can never be returned here, even by
// a crafted request naming its capability directly: the exclusion is
// enforced in lib/capabilityGraph.js's SQL, not in this handler. See
// CAPABILITY_NETWORK.md.
//
// GET /api/capability-routing?capability=insurance_risk_review
// GET /api/capability-routing  (no params — lists the capability taxonomy)

const { getCapabilities, getRoutingRecommendation } = require('../lib/capabilityGraph');
const { isFeatureActive } = require('../lib/featureFlags');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Hidden UI is not security — this feature must be unreachable at the
  // API layer whenever it isn't flipped 'active', not just unlinked.
  if (!(await isFeatureActive('capability_network'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { capability } = req.query || {};

  try {
    if (!capability || !String(capability).trim()) {
      const capabilities = await getCapabilities();
      return res.status(200).json({ capabilities });
    }

    const result = await getRoutingRecommendation({ capabilitySlug: String(capability).trim() });
    return res.status(200).json(result);
  } catch (err) {
    console.error('capability-routing error:', err.message);
    return res.status(500).json({ error: 'Unable to load capability routing.' });
  }
};
