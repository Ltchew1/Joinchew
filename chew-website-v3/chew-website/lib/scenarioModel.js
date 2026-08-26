// lib/scenarioModel.js
//
// The CHEW Scenario Modeling Foundation (see FEATURE_FLAGS.md and
// db/schema.sql's "Scenario Modeling Foundation" section). A Scenario is
// a preserved baseline (what CHEW actually knew, at read time, from the
// real intelligence schema) + an explicit proposed move + explicit
// assumptions + structured effects — never a fabricated prediction.
//
// Identity boundary: this file only ever operates against the one
// seeded illustrative intel_subjects row (see db/seed-intelligence.sql).
// SUBJECT_TYPES includes 'member' so the schema is identity-ready, but
// nothing in this file, and nothing the scenarios table's own CHECK
// constraint permits, can create a 'member' scenario today — that stays
// blocked until a real authenticated member identity layer exists
// (ARCHITECTURE.md Gap 1). Do not add a subjectId-from-request path
// here without that layer in place first.
//
// Dependency reuse: this file computes "what would change" by re-running
// the exact same deterministic rule already powering the Future Room,
// Unlock Room, Life Map, Opportunity Radar, and the real intelligence
// engine — scenario-engine.js's deriveState()/computeRequirementDelta(),
// the same pure functions already reused by 3 public rooms, plus
// lib/intelligenceEngine.js's evaluateRequirement() and
// getRequirementSequence(), plus lib/capabilityGraph.js's real registry
// reads. There is no second, parallel dependency graph anywhere in this
// file.
//
// Nothing here writes to current_state_facts, recommendations, or
// actions — a "proposed move" only ever exists as an in-memory fact
// override used to recompute the shared pure rule; it is never
// persisted as if it were a real observed fact. Only the scenarios
// table itself is written to, and only by the functions in this file.

const { query } = require('./db');
const { evaluateRequirement, getRequirementSequence, RULE_VERSION } = require('./intelligenceEngine');
const { getRoutingRecommendation, getCapabilityOverview } = require('./capabilityGraph');
const ChewScenarioEngine = require('../scenario-engine');

const MODEL_VERSION = 'scenario-model-v1';

const SUBJECT_TYPES = ['illustrative', 'member']; // 'member' is identity-ready but DB-blocked — see db/schema.sql
const TIME_HORIZONS = ['immediate', '30_days', '90_days', '6_months', '12_months', 'custom'];
const REVERSIBILITY_STATES = ['easily_reversible', 'moderately_reversible', 'difficult_to_reverse', 'irreversible', 'unknown'];
const UNCERTAINTY_CLASSES = ['known', 'deterministic', 'assumption_dependent', 'estimated', 'unknown'];
const SCENARIO_STATUSES = ['current', 'stale'];
const MOVE_TYPES = ['resolve_requirement', 'leave_unresolved'];

// Financial dimensions this schema simply does not track for the
// seeded illustrative subject. Named explicitly, per-field, rather than
// silently omitted — a caller asking "what don't you know?" gets an
// honest list instead of an empty object that could be misread as
// "everything is known."
const UNAVAILABLE_DATA_POINTS = [
  { key: 'income', available: false, reason: 'No income table or fact_key exists in this schema yet.' },
  { key: 'liquidity', available: false, reason: 'No liquid-asset tracking exists in this schema yet.' },
  { key: 'employment_history', available: false, reason: 'No employment-history table exists in this schema yet.' },
  { key: 'asset_ownership_detail', available: false, reason: 'No asset-ownership table exists in this schema yet; Hidden Leverage cannot be evaluated against real data because of this gap specifically.' },
];

function assertHorizon(timeHorizon) {
  if (!TIME_HORIZONS.includes(timeHorizon)) {
    throw new Error(`timeHorizon must be one of: ${TIME_HORIZONS.join(', ')}`);
  }
}

async function getRealFactsMap(subjectId) {
  const factsResult = await query(
    `SELECT DISTINCT ON (fact_key) fact_key, fact_value, fact_type, source_note, recorded_at
     FROM current_state_facts
     WHERE subject_id = $1
     ORDER BY fact_key, recorded_at DESC`,
    [subjectId]
  );
  const factsByKey = {};
  factsResult.rows.forEach((row) => { factsByKey[row.fact_key] = row; });
  return factsByKey;
}

// Pure: requirementSequence + real facts (+ optional in-memory
// overrides, used only to model a hypothetical move) -> { key: boolean }.
// This is the ONLY place a fact override is ever applied, and it never
// touches current_state_facts.
function resolvedMapFromFacts(requirementSequence, factsByKey, overrides) {
  const map = {};
  requirementSequence.forEach((r) => {
    const fact = factsByKey[r.key];
    let value = fact ? fact.fact_value : null;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, r.key)) {
      value = overrides[r.key];
    }
    map[r.key] = evaluateRequirement(r.comparison, value, r.requiredValue);
  });
  return map;
}

// The value a requirement's fact would need to hold to be considered
// met — reused to build a "resolve this requirement" override without
// guessing a plausible-looking number. boolean_true resolves to the
// literal string 'true' (identical to how completeAction() resolves a
// boolean_true requirement); a threshold requirement resolves to
// exactly its own required_value — never a fabricated number beyond it.
function resolvedValueFor(requirement) {
  return requirement.comparison === 'boolean_true' ? 'true' : requirement.requiredValue;
}

async function findRequirement(requirementSequence, requirementKey) {
  const req = requirementSequence.find((r) => r.key === requirementKey);
  if (!req) throw new Error(`Requirement "${requirementKey}" is not part of this goal's real requirement chain.`);
  return req;
}

// "What CHEW actually knew, at read time" — every field here is a real,
// already-tested read from the intelligence schema. Never writes.
async function buildBaselineSnapshot({ subjectId, goalId }) {
  const goalResult = await query('SELECT * FROM goals WHERE id = $1 AND subject_id = $2', [goalId, subjectId]);
  const goal = goalResult.rows[0];
  if (!goal) throw new Error('Goal not found for this subject.');

  const requirementSequence = await getRequirementSequence(goalId);
  const factsByKey = await getRealFactsMap(subjectId);
  const constraintsResult = await query(
    `SELECT id, constraint_type, description FROM constraints
     WHERE subject_id = $1 AND is_resolved = FALSE AND (goal_id = $2 OR blocks_transition_id = $3)`,
    [subjectId, goalId, goal.transition_id]
  );
  const capabilityOverview = await getCapabilityOverview();

  const resolvedMap = resolvedMapFromFacts(requirementSequence, factsByKey);
  const state = ChewScenarioEngine.deriveState(requirementSequence, resolvedMap);
  const availabilityMap = ChewScenarioEngine.cloneAvailabilityMap(capabilityOverview);
  const capabilityCoverage = ChewScenarioEngine.deriveCapabilityCoverage(requirementSequence, availabilityMap);

  const chosenReq = requirementSequence.find((r) => r.key === state.chosenKey) || null;
  let relatedCapability = null;
  if (chosenReq && chosenReq.capabilitySlug) {
    relatedCapability = await getRoutingRecommendation({ capabilitySlug: chosenReq.capabilitySlug });
  }

  return {
    capturedAt: new Date().toISOString(),
    goal: { id: goal.id, title: goal.title, category: goal.category },
    requirementSequence,
    requirementState: state.perRequirement,
    readiness: {
      resolvedCount: state.resolvedCount,
      total: state.total,
      pct: state.total ? Math.round((state.resolvedCount / state.total) * 100) : 0,
    },
    currentRecommendation: {
      chosenRequirementKey: state.chosenKey,
      actionIfUnmet: chosenReq ? chosenReq.actionIfUnmet : null,
      relatedCapability,
    },
    constraintState: constraintsResult.rows.map((c) => ({ id: c.id, type: c.constraint_type, description: c.description })),
    capabilityCoverage,
    unavailableDataPoints: UNAVAILABLE_DATA_POINTS,
  };
}

// Re-runs the same deterministic rule against a hypothetical fact
// override. Read-only — never touches current_state_facts,
// recommendations, or actions.
async function evaluateMove({ requirementSequence, factsByKey, capabilityOverview, factOverrides }) {
  const resolvedMap = resolvedMapFromFacts(requirementSequence, factsByKey, factOverrides);
  const state = ChewScenarioEngine.deriveState(requirementSequence, resolvedMap);
  const availabilityMap = ChewScenarioEngine.cloneAvailabilityMap(capabilityOverview);
  const capabilityCoverage = ChewScenarioEngine.deriveCapabilityCoverage(requirementSequence, availabilityMap);

  const chosenReq = requirementSequence.find((r) => r.key === state.chosenKey) || null;
  let relatedCapability = null;
  if (chosenReq && chosenReq.capabilitySlug) {
    relatedCapability = await getRoutingRecommendation({ capabilitySlug: chosenReq.capabilitySlug });
  }

  return { state, capabilityCoverage, relatedCapability, chosenReq };
}

// Structured effects — one row per real, observable change (or
// honestly-reported non-change). Never invents a numeric magnitude
// beyond the real counts/fractions already computed.
function computeEffects({ requirementSequence, before, after, targetRequirement }) {
  const delta = ChewScenarioEngine.computeRequirementDelta(before.state, after.state);
  const effects = [];

  effects.push({
    entity: targetRequirement.key,
    effectType: delta.newlyResolvedKeys.includes(targetRequirement.key) ? 'requirement_resolved' : 'requirement_remains_blocked',
    direction: delta.newlyResolvedKeys.includes(targetRequirement.key) ? 'positive' : 'none',
    explanation: delta.newlyResolvedKeys.includes(targetRequirement.key)
      ? `"${targetRequirement.label}" moves from unmet to met under this move.`
      : `"${targetRequirement.label}" remains unmet under this move.`,
    ruleSource: 'transition_requirements.comparison + evaluateRequirement() (lib/intelligenceEngine.js)',
    uncertaintyClass: 'deterministic',
    timeRelevance: 'at_evaluation',
  });

  effects.push({
    entity: 'readiness',
    effectType: delta.resolvedCountAfter > delta.resolvedCountBefore ? 'readiness_improves' : 'readiness_unchanged',
    direction: delta.resolvedCountAfter > delta.resolvedCountBefore ? 'positive' : 'none',
    explanation: `Readiness moves from ${delta.resolvedCountBefore}/${delta.total} to ${delta.resolvedCountAfter}/${delta.total} real resolved requirements under this move.`,
    ruleSource: 'scenario-engine.js deriveState() resolvedCount',
    uncertaintyClass: 'deterministic',
    timeRelevance: 'at_evaluation',
  });

  effects.push({
    entity: 'recommendation',
    effectType: delta.chosenKeyChanged ? 'recommendation_changes' : 'recommendation_remains_unchanged',
    direction: delta.chosenKeyChanged ? 'shifted' : 'none',
    explanation: delta.chosenKeyChanged
      ? `CHEW's real current focus moves from "${delta.chosenKeyBefore || 'nothing unmet'}" to "${delta.chosenKeyAfter || 'nothing left unmet'}".`
      : `CHEW's real current focus stays "${delta.chosenKeyAfter || 'nothing left unmet'}" — resolving "${targetRequirement.label}" out of its real sequence order does not move the current focus, because this chain is a strict linear order, not a branching graph.`,
    ruleSource: 'chosenRequirementKey = first unmet transition_requirements row by sequence_order (lib/intelligenceEngine.js, ' + RULE_VERSION + ')',
    uncertaintyClass: 'deterministic',
    timeRelevance: 'at_evaluation',
  });

  const capBefore = before.relatedCapability;
  const capAfter = after.relatedCapability;
  const capSlugBefore = capBefore && capBefore.capability ? capBefore.capability.slug : null;
  const capSlugAfter = capAfter && capAfter.capability ? capAfter.capability.slug : null;
  effects.push({
    entity: 'opportunity',
    effectType: capSlugBefore === capSlugAfter
      ? (capAfter && capAfter.available ? 'opportunity_remains_available' : 'opportunity_remains_unavailable')
      : 'opportunity_changes',
    direction: capSlugBefore === capSlugAfter ? 'none' : 'shifted',
    explanation: capSlugBefore === capSlugAfter
      ? (capAfter
          ? `The capability linked to CHEW's current focus ("${capAfter.capability.name}") is unchanged by this move, and this scenario assumes its real provider count doesn't change during the horizon.`
          : 'CHEW\'s current focus has no linked capability, before or after this move.')
      : `The capability linked to CHEW's current focus changes from ${capSlugBefore || 'none'} to ${capSlugAfter || 'none'} as a direct consequence of the recommendation shift above.`,
    ruleSource: 'lib/capabilityGraph.js getRoutingRecommendation() (real, live provider count)',
    uncertaintyClass: capSlugBefore === capSlugAfter ? 'assumption_dependent' : 'deterministic',
    timeRelevance: 'at_evaluation',
  });

  effects.push({
    entity: 'dependency_chain',
    effectType: 'dependency_shift',
    direction: 'none',
    explanation: `This chain is strictly linear by sequence_order (${requirementSequence.length} real requirements) — resolving one requirement only ever changes which single next requirement is unmet; it never removes or introduces a branch, because this schema does not model branching dependencies.`,
    ruleSource: 'transition_requirements.sequence_order (real authored order, not a computed leverage score)',
    uncertaintyClass: 'known',
    timeRelevance: 'structural',
  });

  return effects;
}

function buildAssumptions({ targetRequirement }) {
  return [
    `"${targetRequirement.label}" becomes met at exactly its real required value (${targetRequirement.actionIfUnmet ? 'per its action_if_unmet guidance' : 'per its stored required_value'}) — no intermediate or partial state is modeled.`,
    'All other real facts on file for this scenario remain exactly as they were at baseline capture.',
    'No capability provider is added, removed, or changes status during the modeled horizon.',
    'No new constraint is introduced and no existing constraint is resolved by this move alone.',
  ];
}

function buildRisks({ targetRequirement }) {
  return [
    `This scenario models resolving "${targetRequirement.label}" to exactly its stored required value; if the real fact later differs from that value, this scenario becomes stale (see scenario_status) rather than silently staying "current."`,
    'The schema has no field capturing how reversible resolving any given requirement actually is in the real world, so reversibility is reported as "unknown" rather than an invented guess (see REVERSIBILITY_STATES).',
  ];
}

// ---- Persistence ----

function rowToScenario(row) {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectRef: row.subject_ref,
    goalId: row.goal_id,
    title: row.title,
    description: row.description,
    baselineSnapshot: row.baseline_snapshot,
    proposedMove: row.proposed_move,
    assumptions: row.assumptions,
    timeHorizon: row.time_horizon,
    effects: row.effects,
    dependencies: row.dependencies,
    affectedGoals: row.affected_goals,
    affectedConstraints: row.affected_constraints,
    affectedOpportunities: row.affected_opportunities,
    risks: row.risks,
    reversibility: row.reversibility,
    uncertaintyClassification: row.uncertainty_classification,
    scenarioStatus: row.scenario_status,
    modelVersion: row.model_version,
    ruleVersion: row.rule_version,
    baselineComputedAt: row.baseline_computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The one real, end-to-end scenario slice: baseline -> assumption ->
// modeled move ("resolve one known requirement") -> structured effects
// -> persisted, explainable result. move.type is currently always
// 'resolve_requirement'; 'leave_unresolved' exists only as the no-op
// comparison arm used by compareParallelFutures below, and is never
// itself persisted as a standalone scenario (it IS the baseline).
async function createScenario({ subjectId, goalId, requirementKey, timeHorizon, comparisonGroupKey, title, description }) {
  assertHorizon(timeHorizon);

  const baseline = await buildBaselineSnapshot({ subjectId, goalId });
  const targetRequirement = await findRequirement(baseline.requirementSequence, requirementKey);
  const factsByKey = await getRealFactsMap(subjectId);
  const capabilityOverview = await getCapabilityOverview();

  const beforeEval = await evaluateMove({
    requirementSequence: baseline.requirementSequence, factsByKey, capabilityOverview, factOverrides: null,
  });
  const afterEval = await evaluateMove({
    requirementSequence: baseline.requirementSequence, factsByKey, capabilityOverview,
    factOverrides: { [requirementKey]: resolvedValueFor(targetRequirement) },
  });

  const effects = computeEffects({
    requirementSequence: baseline.requirementSequence, before: beforeEval, after: afterEval, targetRequirement,
  });
  const assumptions = buildAssumptions({ targetRequirement });
  const risks = buildRisks({ targetRequirement });
  const alreadyMet = beforeEval.state.perRequirement.find((r) => r.key === requirementKey).met;

  const proposedMove = {
    type: 'resolve_requirement',
    requirementKey,
    description: `Resolve "${targetRequirement.label}" now.`,
    comparisonGroupKey: comparisonGroupKey || null,
  };

  const insertResult = await query(
    `INSERT INTO scenarios
       (subject_type, subject_ref, goal_id, title, description, baseline_snapshot, proposed_move,
        assumptions, time_horizon, effects, dependencies, affected_goals, affected_constraints,
        affected_opportunities, risks, reversibility, uncertainty_classification, scenario_status,
        model_version, rule_version, baseline_computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING *`,
    [
      'illustrative',
      subjectId,
      goalId,
      title || `Resolve "${targetRequirement.label}"`,
      description || (alreadyMet
        ? `Modeled against a requirement already met in the real baseline — included for completeness, not as a dramatic result.`
        : `Modeled effect of resolving CHEW's real current-focus-adjacent requirement "${targetRequirement.label}".`),
      JSON.stringify(baseline),
      JSON.stringify(proposedMove),
      JSON.stringify(assumptions),
      timeHorizon,
      JSON.stringify(effects),
      JSON.stringify(baseline.requirementSequence),
      JSON.stringify([{ id: baseline.goal.id, title: baseline.goal.title }]),
      JSON.stringify(baseline.constraintState),
      JSON.stringify({ before: beforeEval.relatedCapability, after: afterEval.relatedCapability }),
      JSON.stringify(risks),
      'unknown',
      'deterministic',
      'current',
      MODEL_VERSION,
      RULE_VERSION,
      baseline.capturedAt,
    ]
  );

  return rowToScenario(insertResult.rows[0]);
}

async function getScenario(id) {
  const result = await query('SELECT * FROM scenarios WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) throw new Error('Scenario not found.');
  return checkStaleness(row);
}

async function listScenarios({ subjectId, goalId }) {
  const result = await query(
    'SELECT * FROM scenarios WHERE subject_ref = $1 AND goal_id = $2 ORDER BY created_at DESC',
    [subjectId, goalId]
  );
  const rows = await Promise.all(result.rows.map((row) => checkStaleness(row)));
  return rows;
}

// Compares the scenario's preserved baseline requirement-resolved-map
// against the REAL current facts (read-only). If they differ, the real
// world has moved since this scenario was captured — flip scenario_status
// to 'stale' and persist that flip, but never recompute or overwrite
// the scenario's stored effects. Returns the (possibly just-updated) row.
async function checkStaleness(row) {
  if (row.scenario_status === 'stale') return rowToScenario(row);

  const baseline = row.baseline_snapshot;
  const currentFacts = await getRealFactsMap(row.subject_ref);
  const currentResolvedMap = resolvedMapFromFacts(baseline.requirementSequence, currentFacts);

  const driftFound = baseline.requirementState.some((r) => !!currentResolvedMap[r.key] !== r.met);
  if (!driftFound) return rowToScenario(row);

  const updateResult = await query(
    `UPDATE scenarios SET scenario_status = 'stale', updated_at = now() WHERE id = $1 RETURNING *`,
    [row.id]
  );
  return rowToScenario(updateResult.rows[0]);
}

// Parallel Futures MVP: 2-3 deterministic scenarios sharing one
// baseline capture, each persisted as its own real Scenario row (never
// a second, disconnected comparison structure), tagged with the same
// comparisonGroupKey in their proposed_move JSON.
async function compareParallelFutures({ subjectId, goalId, requirementKeys, timeHorizon }) {
  if (!Array.isArray(requirementKeys) || requirementKeys.length < 2 || requirementKeys.length > 3) {
    throw new Error('requirementKeys must be an array of 2 or 3 real requirement keys.');
  }
  const comparisonGroupKey = `cmp-${goalId}-${Date.now()}`;
  const scenarios = [];
  for (const key of requirementKeys) {
    // eslint-disable-next-line no-await-in-loop -- each comparison arm
    // must read the same real baseline state; running in parallel risks
    // an interleaved write elsewhere between reads, which would make
    // "same baseline" a false claim.
    scenarios.push(await createScenario({ subjectId, goalId, requirementKey: key, timeHorizon, comparisonGroupKey }));
  }
  return {
    comparisonGroupKey,
    scenarios,
    comparisonNote: 'Each option is evaluated against the identical real baseline captured for this comparison. '
      + 'Only dimensions this repo can compute honestly are compared (readiness, current focus, linked capability) — '
      + 'no fabricated cost, timing, or risk score is added to make the comparison look richer.',
  };
}

// Future-Back MVP: reverses the real requirement chain into
// outcome <- required conditions <- current missing conditions <- next
// available action, reusing the identical baseline capture — no second
// engine, no invented outcome date or lifestyle content.
async function buildFutureBackTrace({ subjectId, goalId }) {
  const baseline = await buildBaselineSnapshot({ subjectId, goalId });
  const reversedChain = baseline.requirementState.slice().reverse().map((r) => ({
    key: r.key,
    label: r.label,
    met: r.met,
    isNextAvailableAction: r.key === baseline.currentRecommendation.chosenRequirementKey,
  }));
  return {
    outcome: { goalId: baseline.goal.id, title: baseline.goal.title },
    reversedChain,
    nextAvailableAction: baseline.currentRecommendation.chosenRequirementKey
      ? { requirementKey: baseline.currentRecommendation.chosenRequirementKey, actionIfUnmet: baseline.currentRecommendation.actionIfUnmet }
      : null,
    readiness: baseline.readiness,
    ruleSource: 'Same requirementSequence + resolvedMap used by buildBaselineSnapshot() — no second dependency engine.',
  };
}

module.exports = {
  SUBJECT_TYPES, TIME_HORIZONS, REVERSIBILITY_STATES, UNCERTAINTY_CLASSES, SCENARIO_STATUSES, MOVE_TYPES,
  MODEL_VERSION, RULE_VERSION, UNAVAILABLE_DATA_POINTS,
  buildBaselineSnapshot, createScenario, getScenario, listScenarios, checkStaleness,
  compareParallelFutures, buildFutureBackTrace,
  resolvedMapFromFacts, resolvedValueFor, // exported for direct unit testing only
};
