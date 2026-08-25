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
// GET /api/intelligence-recommendation?subjectId=1&goalId=1

const { computeRecommendation } = require('../lib/intelligenceEngine');
const { isFeatureActive } = require('../lib/featureFlags');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await isFeatureActive('intelligence_engine'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { subjectId, goalId } = req.query || {};
  const subjectIdNum = parseInt(subjectId, 10);
  const goalIdNum = parseInt(goalId, 10);
  if (!Number.isInteger(subjectIdNum) || !Number.isInteger(goalIdNum)) {
    return res.status(400).json({ error: 'subjectId and goalId (integers) are required.' });
  }

  try {
    const result = await computeRecommendation({ subjectId: subjectIdNum, goalId: goalIdNum });
    return res.status(200).json(result);
  } catch (err) {
    if (err.message === 'Goal not found for this subject.') {
      return res.status(404).json({ error: err.message });
    }
    console.error('intelligence-recommendation error:', err.message);
    return res.status(500).json({ error: 'Unable to compute recommendation.' });
  }
};
