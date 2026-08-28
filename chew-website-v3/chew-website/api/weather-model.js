// /api/weather-model.js
//
// Internal-only surface for the CHEW Economic Weather historical-state
// foundation (see lib/weatherModel.js, db/schema.sql's "Economic
// Weather" section, and FEATURE_FLAGS.md). Gated 'internal' in
// feature_flags — deliberately unreachable (404) unless the flag is
// later flipped to at least 'preview', same pattern as
// api/scenario-model.js and api/leverage-model.js.
//
// This never accepts a caller-supplied subjectId. Every request is
// pinned to ILLUSTRATIVE_SUBJECT_ID — the one seeded intel_subjects row
// used everywhere else on this site. There is no real member identity
// system yet (ARCHITECTURE.md Gap 1), and this file must never be
// wired to a real person until that exists — see state_snapshots' own
// CHECK constraint, which blocks a 'member' row at the database level
// regardless of what this file does.
//
// GET /api/weather-model?action=current&goalId=1   — real-time: captures/dedupes a snapshot, returns full Weather (signals + unavailable list)
// GET /api/weather-model?action=snapshots&goalId=1  — real snapshot history, chronological
// GET /api/weather-model?action=latest&goalId=1     — most recent snapshot only, no new capture
// GET /api/weather-model?action=global              — cross-room Opportunity Access, real per-goal provenance disclosed, no goalId required

const weatherModel = require('../lib/weatherModel');
const { isFeatureActive } = require('../lib/featureFlags');

const ILLUSTRATIVE_SUBJECT_ID = 1;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await isFeatureActive('economic_weather_foundation'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const { action, goalId } = req.query || {};

    if (action === 'global') {
      const globalOpportunityAccess = await weatherModel.getGlobalOpportunityAccess({ subjectId: ILLUSTRATIVE_SUBJECT_ID });
      return res.status(200).json({ globalOpportunityAccess });
    }

    const goalIdNum = parseInt(goalId, 10);
    if (!Number.isInteger(goalIdNum)) return res.status(400).json({ error: 'goalId (integer) is required.' });

    if (action === 'snapshots') {
      const snapshots = await weatherModel.listSnapshots({ subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum });
      return res.status(200).json({ snapshots });
    }
    if (action === 'latest') {
      const snapshot = await weatherModel.getLatestSnapshot({ subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum });
      return res.status(200).json({ snapshot });
    }
    // default action: current — always reflects the freshest real state (see getEconomicWeather's staleness discipline)
    const weather = await weatherModel.getEconomicWeather({ subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum });
    return res.status(200).json({ weather });
  } catch (err) {
    if (err.message === 'Goal not found for this subject.') {
      return res.status(404).json({ error: err.message });
    }
    console.error('weather-model error:', err.message);
    return res.status(500).json({ error: 'Unable to process weather request.' });
  }
};
