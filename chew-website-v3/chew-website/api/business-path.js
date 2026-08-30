// /api/business-path.js
//
// Path Engine lookup. Returns the real, seeded requirement steps for a
// business type + jurisdiction, plus a coverage status (VERIFIED / PARTIAL /
// GENERAL_GUIDANCE) describing how complete that answer actually is. Never
// fabricates a requirement — see lib/pathEngine.js and PATH_ENGINE.md.
//
// GET /api/business-path?businessType=llc-formation&state=FL[&county=Orange][&city=Orlando]

const { getBusinessPath } = require('../lib/pathEngine');
const { isFeatureActive } = require('../lib/featureFlags');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Hidden UI is not security — this feature must be unreachable at the
  // API layer whenever it isn't flipped 'active', not just unlinked.
  if (!(await isFeatureActive('path_engine'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { businessType, state, county, city } = req.query || {};
  if (!businessType || !String(businessType).trim()) {
    return res.status(400).json({ error: 'businessType is required.' });
  }
  if (!state || !String(state).trim()) {
    return res.status(400).json({ error: 'state is required.' });
  }

  try {
    const result = await getBusinessPath({
      businessTypeSlug: String(businessType).trim(),
      state: String(state).trim().toUpperCase(),
      county: county ? String(county).trim() : null,
      city: city ? String(city).trim() : null,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('business-path error:', err.message);
    return res.status(500).json({ error: 'Unable to load business path.' });
  }
};
