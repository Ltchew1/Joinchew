// /api/scenario-model.js
//
// Internal-only surface for the CHEW Scenario Modeling Foundation (see
// lib/scenarioModel.js, db/schema.sql's "Scenario Modeling Foundation"
// section, and FEATURE_FLAGS.md). Gated 'internal' in feature_flags —
// deliberately unreachable (404) unless the flag is later flipped to at
// least 'preview', same pattern as api/intelligence-recommendation.js.
//
// This never accepts a caller-supplied subjectId. Every request is
// pinned to ILLUSTRATIVE_SUBJECT_ID — the one seeded intel_subjects row
// used everywhere else on this site. There is no real member identity
// system yet (ARCHITECTURE.md Gap 1), and this file must never be
// wired to a real person until that exists — see the scenarios table's
// own CHECK constraint, which blocks a 'member' scenario at the
// database level regardless of what this file does.
//
// GET  /api/scenario-model?action=baseline&goalId=1
// GET  /api/scenario-model?action=list&goalId=1
// GET  /api/scenario-model?action=futureBack&goalId=1
// GET  /api/scenario-model?id=5
// POST /api/scenario-model { action: 'create', goalId, requirementKey, timeHorizon }
// POST /api/scenario-model { action: 'compareParallelFutures', goalId, requirementKeys, timeHorizon }

const scenarioModel = require('../lib/scenarioModel');
const { isFeatureActive } = require('../lib/featureFlags');

const ILLUSTRATIVE_SUBJECT_ID = 1;

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await isFeatureActive('scenario_modeling'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    if (req.method === 'GET') {
      const { action, goalId, id } = req.query || {};

      if (id) {
        const idNum = parseInt(id, 10);
        if (!Number.isInteger(idNum)) return res.status(400).json({ error: 'id must be an integer.' });
        const scenario = await scenarioModel.getScenario(idNum);
        return res.status(200).json({ scenario });
      }

      const goalIdNum = parseInt(goalId, 10);
      if (!Number.isInteger(goalIdNum)) return res.status(400).json({ error: 'goalId (integer) is required.' });

      if (action === 'list') {
        const scenarios = await scenarioModel.listScenarios({ subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum });
        return res.status(200).json({ scenarios });
      }
      if (action === 'futureBack') {
        const trace = await scenarioModel.buildFutureBackTrace({ subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum });
        return res.status(200).json({ futureBack: trace });
      }
      // default GET action: baseline
      const baseline = await scenarioModel.buildBaselineSnapshot({ subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum });
      return res.status(200).json({ baseline });
    }

    // POST
    const { action, goalId, requirementKey, requirementKeys, timeHorizon } = req.body || {};
    const goalIdNum = parseInt(goalId, 10);
    if (!Number.isInteger(goalIdNum)) return res.status(400).json({ error: 'goalId (integer) is required.' });

    if (action === 'compareParallelFutures') {
      const comparison = await scenarioModel.compareParallelFutures({
        subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum, requirementKeys, timeHorizon,
      });
      return res.status(200).json({ comparison });
    }

    if (action !== 'create') {
      return res.status(400).json({ error: 'action must be "create" or "compareParallelFutures".' });
    }
    if (!requirementKey) return res.status(400).json({ error: 'requirementKey is required to create a scenario.' });

    const scenario = await scenarioModel.createScenario({
      subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum, requirementKey, timeHorizon,
    });
    return res.status(201).json({ scenario });
  } catch (err) {
    if (err.message === 'Goal not found for this subject.' || err.message === 'Scenario not found.'
        || err.message.includes('is not part of this goal')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.startsWith('timeHorizon must be') || err.message.startsWith('requirementKeys must be')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('scenario-model error:', err.message);
    return res.status(500).json({ error: 'Unable to process scenario request.' });
  }
};
