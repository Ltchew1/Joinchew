// /api/friction-model.js
//
// Internal-only surface for the CHEW Friction Detection historical-
// pattern foundation (see lib/frictionModel.js and FEATURE_FLAGS.md's
// "Friction Detection" section). Gated 'internal' in feature_flags —
// deliberately unreachable (404) unless the flag is later flipped to
// at least 'preview', same pattern as api/scenario-model.js,
// api/leverage-model.js, and api/weather-model.js.
//
// This never accepts a caller-supplied subjectId. Every request is
// pinned to ILLUSTRATIVE_SUBJECT_ID — the one seeded intel_subjects row
// used everywhere else on this site. There is no real member identity
// system yet (ARCHITECTURE.md Gap 1), and this file must never be
// wired to a real person until that exists.
//
// GET /api/friction-model?goalId=1 — real friction results for this goal:
//   { active: [...], resolved: [...], skipped, skippedReason, materialObservationCount }

const frictionModel = require('../lib/frictionModel');
const { isFeatureActive } = require('../lib/featureFlags');

const ILLUSTRATIVE_SUBJECT_ID = 1;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await isFeatureActive('friction_detection'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const { goalId } = req.query || {};
    const goalIdNum = parseInt(goalId, 10);
    if (!Number.isInteger(goalIdNum)) return res.status(400).json({ error: 'goalId (integer) is required.' });

    const friction = await frictionModel.getFrictionForGoal({ subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum });
    return res.status(200).json({ friction });
  } catch (err) {
    if (err.message === 'Goal not found for this subject.') {
      return res.status(404).json({ error: err.message });
    }
    console.error('friction-model error:', err.message);
    return res.status(500).json({ error: 'Unable to process friction request.' });
  }
};
