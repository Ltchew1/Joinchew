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
//
// Also returns requirementSequence: the real, ordered list of
// transition_requirements for this scenario's transition (with
// capability links where they exist) — used by the CHEW Domino
// simulation on the frontend. This is real, non-sensitive rules
// metadata (same class of data api/business-path.js already exposes),
// not a live-write path — nothing in this file ever calls
// completeAction() or writes to the database. A public, repeatable demo
// endpoint must never mutate the shared illustrative subject's state,
// or it would silently corrupt this same demo for every future visitor.
//
// Also returns capabilityOverview: every real capability from the
// registry with a LIVE count of active/ready providers (see
// lib/capabilityGraph.js's getCapabilityOverview) — used by the public
// "Opportunity Radar." No capability here ever carries a fabricated
// "expiring soon" or "newly opened" state; nothing in this schema
// tracks capability freshness, so the radar only ever shows what's
// actually true right now: connected to this scenario or not, and
// whether a real provider exists.

const { computeRecommendation } = require('../lib/intelligenceEngine');
const { getCapabilityOverview } = require('../lib/capabilityGraph');
const { isFeatureActive } = require('../lib/featureFlags');
const { query } = require('../lib/db');

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

    const sequenceResult = await query(
      `SELECT tr.requirement_key, tr.label, tr.sequence_order, tr.action_if_unmet,
              c.slug AS capability_slug, c.name AS capability_name
       FROM transition_requirements tr
       JOIN goals g ON g.transition_id = tr.transition_id
       LEFT JOIN capabilities c ON c.id = tr.capability_id
       WHERE g.id = $1
       ORDER BY tr.sequence_order ASC`,
      [scenario.goalId]
    );
    const requirementSequence = sequenceResult.rows.map((row) => ({
      key: row.requirement_key,
      label: row.label,
      sequenceOrder: row.sequence_order,
      actionIfUnmet: row.action_if_unmet,
      capabilitySlug: row.capability_slug,
      capabilityName: row.capability_name,
    }));

    const capabilityOverview = await getCapabilityOverview();

    return res.status(200).json({
      isExample: true,
      disclaimer: 'This is a demo experience using an illustrative example scenario, not your personal data. Numeric thresholds shown are examples for testing CHEW\'s logic, not verified financial or lending guidance.',
      scenarioLabel: scenario.label,
      recommendation,
      requirementSequence,
      capabilityOverview,
    });
  } catch (err) {
    console.error('intelligence-demo error:', err.message);
    return res.status(500).json({ error: 'Unable to compute demo recommendation.' });
  }
};
