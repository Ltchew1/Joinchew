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
// GET  /api/scenario-model?action=listConflictRules&goalId=1
// GET  /api/scenario-model?id=5
// POST /api/scenario-model { action: 'create', goalId, requirementKey, timeHorizon }
// POST /api/scenario-model { action: 'compareParallelFutures', goalId, requirementKeys, timeHorizon }
// POST /api/scenario-model { action: 'createCrossGoalScenario', goalAId, goalBId, factKey, hypotheticalValue, timeHorizon }
//   Multi-goal Conflict Detection (see lib/scenarioModel.js's
//   getConflictRule()) — refuses (404) unless goal_conflict_rules
//   already declares a rule for exactly this goal pair and fact.
// POST /api/scenario-model { action: 'compareCrossGoalFutures', goalAId, goalBId, paths, timeHorizon }
//   Parallel Futures, real multi-goal comparison — 2-3 paths sharing one
//   baseline capture across both goals. Each path is
//   { label, move: { type: 'preserve' } }
//   { label, move: { type: 'cross_goal_fact_change', factKey, hypotheticalValue } }
//   { label, move: { type: 'resolve_requirement', goalId, requirementKey } }
//   Never ranks the paths; refuses (404) if any cross_goal_fact_change
//   path names an undeclared goal_conflict_rules pair/fact.

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
      if (action === 'listConflictRules') {
        const rules = await scenarioModel.listConflictRulesForGoal(goalIdNum);
        return res.status(200).json({ rules });
      }
      // default GET action: baseline
      const baseline = await scenarioModel.buildBaselineSnapshot({ subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum });
      return res.status(200).json({ baseline });
    }

    // POST
    const { action, goalId, requirementKey, requirementKeys, timeHorizon, goalAId, goalBId, factKey, hypotheticalValue, paths } = req.body || {};

    if (action === 'createCrossGoalScenario') {
      const goalAIdNum = parseInt(goalAId, 10);
      const goalBIdNum = parseInt(goalBId, 10);
      if (!Number.isInteger(goalAIdNum) || !Number.isInteger(goalBIdNum)) {
        return res.status(400).json({ error: 'goalAId and goalBId (integers) are required.' });
      }
      if (!factKey) return res.status(400).json({ error: 'factKey is required.' });
      const scenario = await scenarioModel.createCrossGoalScenario({
        subjectId: ILLUSTRATIVE_SUBJECT_ID, goalAId: goalAIdNum, goalBId: goalBIdNum, factKey, hypotheticalValue, timeHorizon,
      });
      return res.status(201).json({ scenario });
    }

    if (action === 'compareCrossGoalFutures') {
      const goalAIdNum = parseInt(goalAId, 10);
      const goalBIdNum = parseInt(goalBId, 10);
      if (!Number.isInteger(goalAIdNum) || !Number.isInteger(goalBIdNum)) {
        return res.status(400).json({ error: 'goalAId and goalBId (integers) are required.' });
      }
      const comparison = await scenarioModel.compareCrossGoalFutures({
        subjectId: ILLUSTRATIVE_SUBJECT_ID, goalAId: goalAIdNum, goalBId: goalBIdNum, paths, timeHorizon,
      });
      return res.status(200).json({ comparison });
    }

    const goalIdNum = parseInt(goalId, 10);
    if (!Number.isInteger(goalIdNum)) return res.status(400).json({ error: 'goalId (integer) is required.' });

    if (action === 'compareParallelFutures') {
      const comparison = await scenarioModel.compareParallelFutures({
        subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum, requirementKeys, timeHorizon,
      });
      return res.status(200).json({ comparison });
    }

    if (action !== 'create') {
      return res.status(400).json({ error: 'action must be "create", "compareParallelFutures", "createCrossGoalScenario", or "compareCrossGoalFutures".' });
    }
    if (!requirementKey) return res.status(400).json({ error: 'requirementKey is required to create a scenario.' });

    const scenario = await scenarioModel.createScenario({
      subjectId: ILLUSTRATIVE_SUBJECT_ID, goalId: goalIdNum, requirementKey, timeHorizon,
    });
    return res.status(201).json({ scenario });
  } catch (err) {
    if (err.message === 'Goal not found for this subject.' || err.message === 'Scenario not found.'
        || err.message.includes('is not part of this goal') || err.message.startsWith('No rule-backed conflict is declared')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.startsWith('timeHorizon must be') || err.message.startsWith('requirementKeys must be')
        || err.message.startsWith('hypotheticalValue is required') || err.message.startsWith('paths must be')
        || err.message.startsWith('Each path needs') || err.message.startsWith('moveGoalId must be')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('scenario-model error:', err.message);
    return res.status(500).json({ error: 'Unable to process scenario request.' });
  }
};
