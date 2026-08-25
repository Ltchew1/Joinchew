// /api/intelligence-demo.js
//
// Public, safe-by-construction demo of the CHEW Intelligence System
// (ARCHITECTURE.md). This is NOT the general intelligence-recommendation
// API — it never accepts an arbitrary subjectId/goalId. It only ever
// computes against the two pre-seeded illustrative scenarios in
// db/seed-intelligence.sql, whose numeric thresholds are explicitly
// marked example-only, not real financial guidance. This is what makes
// it safe to expose publicly while api/intelligence-recommendation.js
// stays gated 'internal' (no real subject/identity system exists yet —
// see ARCHITECTURE.md Gap 1).
//
// Every response is wrapped with isExample: true and an explicit
// disclaimer — the frontend must never present this as the visitor's
// own data, and neither should any future caller of this endpoint.
//
// GET /api/intelligence-demo?goal=home|funding

const { computeRecommendation } = require('../lib/intelligenceEngine');
const { isFeatureActive } = require('../lib/featureFlags');

// Fixed mapping to the illustrative seed data — never derived from
// caller input beyond selecting which of the two pre-built scenarios to
// show. subjectId 1 and these goal ids only exist as the synthetic test
// subject seeded by db/seed-intelligence.sql.
const DEMO_SCENARIOS = {
  home: {
    subjectId: 1,
    goalId: 1,
    label: 'Renter working toward homebuyer-ready (illustrative)',
  },
  funding: {
    subjectId: 1,
    goalId: 2,
    label: 'Business documentation toward funding-ready (illustrative)',
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await isFeatureActive('intelligence_demo'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { goal } = req.query || {};
  const scenario = DEMO_SCENARIOS[goal];
  if (!scenario) {
    return res.status(400).json({ error: 'goal must be "home" or "funding".' });
  }

  try {
    const recommendation = await computeRecommendation({
      subjectId: scenario.subjectId,
      goalId: scenario.goalId,
    });
    return res.status(200).json({
      isExample: true,
      disclaimer: 'This is a demo experience using an illustrative example scenario, not your personal data. Numeric thresholds shown are examples for testing CHEW\'s logic, not verified financial or lending guidance.',
      scenarioLabel: scenario.label,
      recommendation,
    });
  } catch (err) {
    console.error('intelligence-demo error:', err.message);
    return res.status(500).json({ error: 'Unable to compute demo recommendation.' });
  }
};
