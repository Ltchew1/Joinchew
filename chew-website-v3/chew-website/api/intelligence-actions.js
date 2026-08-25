// /api/intelligence-actions.js
//
// Action/task tracking for the CHEW Intelligence System MVP (see
// ARCHITECTURE.md). Lists a subject's actions, or marks one complete
// and returns the recomputed recommendation for its goal — closing
// decision-loop steps 8 (record action), 9 (observe new state), and 10
// (recalculate path) in one round trip.
//
// Gated 'internal' in feature_flags, same as api/intelligence-recommendation.js
// — not reachable unless flipped to at least 'preview'. No real
// subject/user identity system exists yet (ARCHITECTURE.md Gap 1).
//
// GET  /api/intelligence-actions?subjectId=1[&status=pending]
// POST /api/intelligence-actions { subjectId, actionId, factValue? }
//   factValue is required to complete an action linked to a
//   gte/lte/eq requirement (CHEW will not guess it); omit it for a
//   boolean_true requirement, where completion alone is the fact.

const { completeAction, listActions, computeRecommendation } = require('../lib/intelligenceEngine');
const { isFeatureActive } = require('../lib/featureFlags');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await isFeatureActive('intelligence_engine'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    if (req.method === 'GET') {
      const { subjectId, status } = req.query || {};
      const subjectIdNum = parseInt(subjectId, 10);
      if (!Number.isInteger(subjectIdNum)) {
        return res.status(400).json({ error: 'subjectId (integer) is required.' });
      }
      if (status && !['pending', 'completed', 'skipped'].includes(status)) {
        return res.status(400).json({ error: 'status must be pending, completed, or skipped.' });
      }
      const actions = await listActions({ subjectId: subjectIdNum, status: status || null });
      return res.status(200).json({ actions });
    }

    const { subjectId, actionId, factValue } = req.body || {};
    const subjectIdNum = parseInt(subjectId, 10);
    const actionIdNum = parseInt(actionId, 10);
    if (!Number.isInteger(subjectIdNum) || !Number.isInteger(actionIdNum)) {
      return res.status(400).json({ error: 'subjectId and actionId (integers) are required.' });
    }

    const completion = await completeAction({ actionId: actionIdNum, subjectId: subjectIdNum, factValue });
    const recommendation = await computeRecommendation({ subjectId: subjectIdNum, goalId: completion.goalId });
    return res.status(200).json({ completion, recommendation });
  } catch (err) {
    if (err.message === 'Action not found for this subject.' || err.message === 'Goal not found for this subject.') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.startsWith('Action is already')) {
      return res.status(409).json({ error: err.message });
    }
    if (err.message.startsWith('factValue')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('intelligence-actions error:', err.message);
    return res.status(500).json({ error: 'Unable to process action.' });
  }
};
