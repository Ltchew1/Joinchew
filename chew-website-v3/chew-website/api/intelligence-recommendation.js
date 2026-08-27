// /api/intelligence-recommendation.js
//
// MVP slice of the CHEW Intelligence System (see ARCHITECTURE.md).
// Computes an explainable next-action recommendation for one goal,
// from stored facts/requirements/constraints — never a fabricated or
// ML-guessed answer.
//
// Gated 'internal' in feature_flags (see FEATURE_FLAGS.md) — this
// deliberately has NO public_teaser_enabled card and is not reachable
// unless the flag is flipped to at least 'preview'. There is no real
// subject/user identity system behind this yet (ARCHITECTURE.md Gap 1),
// so this must never be wired to a real person until that exists.
//
// GET  — PURE READ. Calls computeRecommendation(), which writes nothing
//   (see ARCHITECTURE.md's "Recommendation purity" doctrine). Never
//   persists a `recommendations` row; the response has no `id`/
//   `computedAt` because nothing was recorded. Safe to call any number
//   of times.
// POST — the ONE explicit-command entry point on this endpoint that
//   intentionally records real history: calls recordRecommendation(),
//   still deduped by real state fingerprint (a POST with no real state
//   change writes nothing new either). This exists specifically so a
//   goal can get its first real recorded recommendation + first pending
//   `actions` row from *something* — before this file's purity fix,
//   any GET did this as an unintended side effect; now creating that
//   first record requires an explicit POST, exactly the same "explicit
//   command requires history" carve-out api/intelligence-actions.js's
//   POST already uses after completeAction().
//
// GET  /api/intelligence-recommendation?subjectId=1&goalId=1
// POST /api/intelligence-recommendation { subjectId, goalId }

const { computeRecommendation, recordRecommendation } = require('../lib/intelligenceEngine');
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
      const { subjectId, goalId } = req.query || {};
      const subjectIdNum = parseInt(subjectId, 10);
      const goalIdNum = parseInt(goalId, 10);
      if (!Number.isInteger(subjectIdNum) || !Number.isInteger(goalIdNum)) {
        return res.status(400).json({ error: 'subjectId and goalId (integers) are required.' });
      }
      const result = await computeRecommendation({ subjectId: subjectIdNum, goalId: goalIdNum });
      return res.status(200).json(result);
    }

    const { subjectId, goalId } = req.body || {};
    const subjectIdNum = parseInt(subjectId, 10);
    const goalIdNum = parseInt(goalId, 10);
    if (!Number.isInteger(subjectIdNum) || !Number.isInteger(goalIdNum)) {
      return res.status(400).json({ error: 'subjectId and goalId (integers) are required.' });
    }
    const { recommendation, action, wasNew } = await recordRecommendation({ subjectId: subjectIdNum, goalId: goalIdNum });
    return res.status(200).json({ recommendation, action, wasNew });
  } catch (err) {
    if (err.message === 'Goal not found for this subject.') {
      return res.status(404).json({ error: err.message });
    }
    console.error('intelligence-recommendation error:', err.message);
    return res.status(500).json({ error: 'Unable to process recommendation request.' });
  }
};
