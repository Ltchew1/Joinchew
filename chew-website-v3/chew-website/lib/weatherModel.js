// lib/weatherModel.js
//
// The CHEW Economic Weather historical-state foundation (see
// FEATURE_FLAGS.md and db/schema.sql's "Economic Weather" section).
// Answers a third distinct question from the other two intelligence
// foundations in this repo: not "what would change if I moved this
// fact?" (Scenario Modeling) and not "what already exists that's
// underused?" (Hidden Leverage), but "what did CHEW actually observe,
// and how has it genuinely changed since the last time it looked?"
//
// THE AUDIT THIS FILE'S COLUMN LIST IS BASED ON — every field a
// state_snapshots row stores was checked against real, already-tested
// code before being included:
//   - readiness numerator/denominator, resolved/unresolved requirement
//     counts, current focus — all already computed by
//     lib/scenarioModel.js's buildBaselineSnapshot(), reused here
//     verbatim, not recomputed a second way.
//   - unresolved constraint count ("active barriers") — the real
//     constraintState array buildBaselineSnapshot() already returns.
//   - linked/active opportunity count — the real capabilityCoverage
//     buildBaselineSnapshot() already derives via scenario-engine.js's
//     deriveCapabilityCoverage(), null (never a fabricated 0) when
//     nothing links.
//   - capability availability count — lib/capabilityGraph.js's real,
//     live getCapabilityOverview(), site-wide rather than goal-scoped,
//     which is a genuinely different real signal than the goal-scoped
//     opportunity count above.
//   - liquidity, income, credit trend, employment stability, net worth,
//     asset growth, spending pressure, debt trend, cash runway, market
//     exposure — NONE of these exist anywhere in this schema. They are
//     never estimated from unrelated fields; see UNAVAILABLE_SIGNALS
//     below, which names each one explicitly rather than omitting them
//     silently.
//
// TREND DISCIPLINE — the whole reason this file exists: a signal never
// says "improving," "worsening," "momentum," or "trajectory" without
// enough real comparable snapshots to support it.
//   0 prior snapshots  -> availability 'current_state_only', no comparison at all
//   1 prior snapshot   -> availability 'change_since_last_observation' (a single
//                          before/after delta — explicitly NOT called a trend)
//   2+ prior snapshots -> availability 'trend', classified from the real
//                          sequence of consecutive deltas (improving/worsening/
//                          stable/mixed), never a fabricated momentum score
//
// HISTORY VS SCENARIO — a snapshot is only ever built from
// buildBaselineSnapshot()'s REAL current-facts read. This file never
// imports createScenario/createCrossGoalScenario/compareCrossGoalFutures
// or reads the `scenarios` table at all — a modeled hypothetical move
// must never be able to leak into what CHEW claims actually happened.

const crypto = require('crypto');
const { query } = require('./db');
const { buildBaselineSnapshot } = require('./scenarioModel');
const { getCapabilityOverview } = require('./capabilityGraph');
const { stableStringify } = require('./util');

const WEATHER_MODEL_VERSION = 'weather-model-v1';

const SNAPSHOT_REASONS = [
  'initial_baseline', 'requirement_changed', 'barrier_resolved', 'recommendation_changed',
  'opportunity_unlocked', 'capability_state_changed', 'scenario_recalculated', 'manual_internal_snapshot',
];
// Which reasons this pass can actually produce, honestly. The rest are
// real, legal schema values for a future event-integration pass (see
// this directive's own note that snapshot triggers "should eventually
// connect to the Global Portal State Layer" — which doesn't exist yet)
// — never fired by fabricated event detection in the meantime.
const IMPLEMENTED_SNAPSHOT_REASONS = ['initial_baseline', 'manual_internal_snapshot', 'requirement_changed'];

const SIGNAL_TYPES = ['readiness', 'constraint_pressure', 'opportunity_access', 'priority_focus', 'capability_access'];

// Fixed, precise, non-metaphorical vocabulary — no "storm"/"sunny"/
// "dangerous" language. "environment," not "judgment."
const CHANGE_WORDS = {
  readiness: { up: 'improved', down: 'declined', flat: 'unchanged' },
  constraint_pressure: { up: 'increased', down: 'eased', flat: 'unchanged' }, // "up" = more unresolved constraints = worse
  opportunity_access: { up: 'expanded', down: 'contracted', flat: 'unchanged' },
  capability_access: { up: 'expanded', down: 'contracted', flat: 'unchanged' },
};
const TREND_WORDS = { improving: 'improving', worsening: 'worsening', stable: 'stable', mixed: 'mixed' };

// Named explicitly, per-field, rather than silently absent — a caller
// asking "what can't Weather see yet?" gets an honest list, not a gap
// it has to notice on its own.
const UNAVAILABLE_SIGNALS = [
  { signal: 'liquidity', reason: 'No liquid-asset or cash-balance table exists in this schema yet.' },
  { signal: 'income_stability', reason: 'No income table or fact_key exists in this schema yet.' },
  { signal: 'net_worth_trend', reason: 'No asset or liability valuation table exists in this schema yet.' },
  { signal: 'asset_growth', reason: 'No asset-ownership or valuation-history table exists in this schema yet.' },
  { signal: 'spending_pressure', reason: 'No transaction or spending data exists anywhere in this schema.' },
  { signal: 'debt_trend', reason: 'No debt/liability table exists in this schema yet.' },
  { signal: 'employment_stability', reason: 'No employment-history table exists in this schema yet.' },
  { signal: 'cash_runway', reason: 'Requires both income and spending data, neither of which exists in this schema.' },
  { signal: 'credit_trend', reason: 'Only a single current credit_score fact exists for this scenario; no history is stored, so a trend cannot be computed honestly.' },
  { signal: 'market_exposure', reason: 'No investment or market-exposure data exists anywhere in this schema.' },
].map((s) => ({ ...s, availability: 'unavailable' }));

function rowToSnapshot(row) {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectRef: row.subject_ref,
    goalId: row.goal_id,
    observedAt: row.observed_at,
    snapshotReason: row.snapshot_reason,
    readinessNumerator: row.readiness_numerator,
    readinessDenominator: row.readiness_denominator,
    resolvedRequirementCount: row.resolved_requirement_count,
    unresolvedRequirementCount: row.unresolved_requirement_count,
    currentFocusRequirementKey: row.current_focus_requirement_key,
    currentFocusAction: row.current_focus_action,
    unresolvedConstraintCount: row.unresolved_constraint_count,
    linkedCapabilityCount: row.linked_capability_count,
    activeOpportunityCount: row.active_opportunity_count,
    capabilityAvailabilityCount: row.capability_availability_count,
    capabilityTotalCount: row.capability_total_count,
    stateFingerprint: row.state_fingerprint,
    rawStatePayload: row.raw_state_payload,
    sourceVersion: row.source_version,
    ruleVersion: row.rule_version,
    createdAt: row.created_at,
  };
}

// The exact real fields a fingerprint is computed over — deliberately
// excludes observed_at/snapshot_reason/created_at (volatile metadata,
// not meaningful state) and rawStatePayload (would make two
// semantically-identical states hash differently over irrelevant
// capability ordering, etc.).
function fingerprintFields(fields) {
  return {
    readinessNumerator: fields.readinessNumerator,
    readinessDenominator: fields.readinessDenominator,
    resolvedRequirementCount: fields.resolvedRequirementCount,
    unresolvedRequirementCount: fields.unresolvedRequirementCount,
    currentFocusRequirementKey: fields.currentFocusRequirementKey,
    unresolvedConstraintCount: fields.unresolvedConstraintCount,
    linkedCapabilityCount: fields.linkedCapabilityCount,
    activeOpportunityCount: fields.activeOpportunityCount,
    capabilityAvailabilityCount: fields.capabilityAvailabilityCount,
    capabilityTotalCount: fields.capabilityTotalCount,
  };
}

function computeFingerprint(fields) {
  return crypto.createHash('sha256').update(stableStringify(fingerprintFields(fields))).digest('hex');
}

// Reads ONLY real current state — buildBaselineSnapshot() (real,
// already-tested) plus one real site-wide capability read. Never reads
// the scenarios table, never accepts a hypothetical override.
async function computeCurrentStateFields({ subjectId, goalId }) {
  const baseline = await buildBaselineSnapshot({ subjectId, goalId });
  const capabilityOverview = await getCapabilityOverview();
  const capabilityAvailabilityCount = capabilityOverview.filter((c) => c.available).length;

  return {
    readinessNumerator: baseline.readiness.resolvedCount,
    readinessDenominator: baseline.readiness.total,
    resolvedRequirementCount: baseline.readiness.resolvedCount,
    unresolvedRequirementCount: baseline.readiness.total - baseline.readiness.resolvedCount,
    currentFocusRequirementKey: baseline.currentRecommendation.chosenRequirementKey,
    currentFocusAction: baseline.currentRecommendation.actionIfUnmet,
    unresolvedConstraintCount: baseline.constraintState.length,
    linkedCapabilityCount: baseline.capabilityCoverage ? baseline.capabilityCoverage.linkedCount : null,
    activeOpportunityCount: baseline.capabilityCoverage ? baseline.capabilityCoverage.availableCount : null,
    capabilityAvailabilityCount,
    capabilityTotalCount: capabilityOverview.length,
    rawStatePayload: {
      requirementState: baseline.requirementState,
      capabilityCoverage: baseline.capabilityCoverage,
      constraintState: baseline.constraintState,
      goalTitle: baseline.goal.title,
    },
  };
}

async function getLatestSnapshot({ subjectId, goalId }) {
  const result = await query(
    `SELECT * FROM state_snapshots WHERE subject_ref = $1 AND goal_id = $2 ORDER BY observed_at DESC LIMIT 1`,
    [subjectId, goalId]
  );
  return result.rows[0] ? rowToSnapshot(result.rows[0]) : null;
}

async function listSnapshots({ subjectId, goalId }) {
  const result = await query(
    `SELECT * FROM state_snapshots WHERE subject_ref = $1 AND goal_id = $2 ORDER BY observed_at ASC`,
    [subjectId, goalId]
  );
  return result.rows.map(rowToSnapshot);
}

// The one write path in this file. Dedup rule: if the real current
// state's fingerprint matches the most recent snapshot's fingerprint,
// nothing is persisted — the existing snapshot is returned with
// wasNew: false. This is a "no consecutive duplicates" rule, not global
// uniqueness — the same real state legitimately recurring much later
// (e.g. after a reverted test fact) still deserves its own snapshot
// when something material happens again.
async function captureSnapshot({ subjectId, goalId, reason }) {
  if (!SNAPSHOT_REASONS.includes(reason)) {
    throw new Error(`snapshot reason must be one of: ${SNAPSHOT_REASONS.join(', ')}`);
  }
  if (!IMPLEMENTED_SNAPSHOT_REASONS.includes(reason)) {
    throw new Error(`snapshot reason "${reason}" is a legal future value but has no real trigger implemented yet.`);
  }

  const fields = await computeCurrentStateFields({ subjectId, goalId });
  const fingerprint = computeFingerprint(fields);

  const latest = await getLatestSnapshot({ subjectId, goalId });
  if (latest && latest.stateFingerprint === fingerprint) {
    return { snapshot: latest, wasNew: false };
  }

  const effectiveReason = latest ? reason : 'initial_baseline';
  const insertResult = await query(
    `INSERT INTO state_snapshots
       (subject_type, subject_ref, goal_id, snapshot_reason, readiness_numerator, readiness_denominator,
        resolved_requirement_count, unresolved_requirement_count, current_focus_requirement_key,
        current_focus_action, unresolved_constraint_count, linked_capability_count, active_opportunity_count,
        capability_availability_count, capability_total_count, state_fingerprint, raw_state_payload,
        source_version, rule_version)
     VALUES ('illustrative', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      subjectId, goalId, effectiveReason, fields.readinessNumerator, fields.readinessDenominator,
      fields.resolvedRequirementCount, fields.unresolvedRequirementCount, fields.currentFocusRequirementKey,
      fields.currentFocusAction, fields.unresolvedConstraintCount, fields.linkedCapabilityCount,
      fields.activeOpportunityCount, fields.capabilityAvailabilityCount, fields.capabilityTotalCount,
      fingerprint, JSON.stringify(fields.rawStatePayload), WEATHER_MODEL_VERSION, WEATHER_MODEL_VERSION,
    ]
  );
  return { snapshot: rowToSnapshot(insertResult.rows[0]), wasNew: true };
}

function directionWord(signalType, before, after) {
  const words = CHANGE_WORDS[signalType];
  if (after > before) return words.up;
  if (after < before) return words.down;
  return words.flat;
}

// Real, deterministic trend rule over the FULL ordered sequence of
// values (oldest to newest) — never a single before/after pair. Looks
// at every consecutive delta: all non-negative (and at least one
// positive) = improving; all non-positive (and at least one negative)
// = worsening; all zero = stable; anything else = mixed. This is
// exactly what "a real sequence, not a guessed momentum score" means.
function classifyTrend(signalType, orderedValues) {
  const deltas = [];
  for (let i = 1; i < orderedValues.length; i++) deltas.push(orderedValues[i] - orderedValues[i - 1]);
  const rawDeltas = signalType === 'constraint_pressure' ? deltas.map((d) => -d) : deltas; // constraint_pressure: fewer unresolved = improvement
  const allNonNeg = rawDeltas.every((d) => d >= 0);
  const allNonPos = rawDeltas.every((d) => d <= 0);
  const anyPos = rawDeltas.some((d) => d > 0);
  const anyNeg = rawDeltas.some((d) => d < 0);
  if (allNonNeg && anyPos) return TREND_WORDS.improving;
  if (allNonPos && anyNeg) return TREND_WORDS.worsening;
  if (rawDeltas.every((d) => d === 0)) return TREND_WORDS.stable;
  return TREND_WORDS.mixed;
}

function buildNumericSignal({ signalType, label, currentValue, priorValues, evidenceIds, explanationUnit }) {
  const history = priorValues.length;
  if (history === 0) {
    return {
      signal: signalType, label, currentState: currentValue, comparisonState: null,
      trendClassification: 'current_state_only',
      explanation: `${label}: ${currentValue}${explanationUnit || ''} — no prior comparable observation exists yet.`,
      evidence: evidenceIds, availability: 'available', historySufficiency: 0,
    };
  }
  if (history === 1) {
    const prior = priorValues[0];
    const word = directionWord(signalType, prior, currentValue);
    return {
      signal: signalType, label, currentState: currentValue, comparisonState: prior,
      trendClassification: 'change_since_last_observation',
      explanation: `${label} ${word} since the last observation (${prior}${explanationUnit || ''} → ${currentValue}${explanationUnit || ''}).`,
      evidence: evidenceIds, availability: 'available', historySufficiency: 1,
    };
  }
  const ordered = [...priorValues, currentValue]; // priorValues passed oldest-first by the caller
  const trend = classifyTrend(signalType, ordered);
  return {
    signal: signalType, label, currentState: currentValue, comparisonState: priorValues[priorValues.length - 1],
    trendClassification: trend,
    explanation: `${label} is ${trend} across ${ordered.length} real observations (${ordered.join(' → ')}${explanationUnit || ''}).`,
    evidence: evidenceIds, availability: 'available', historySufficiency: history,
  };
}

// Pure-ish function over already-fetched comparable snapshots — does
// not itself decide whether to capture a new one (see
// getEconomicWeather() below for that orchestration).
function buildEconomicWeather(currentSnapshot, priorSnapshotsOldestFirst) {
  const readinessPctOf = (s) => (s.readinessDenominator ? Math.round((s.readinessNumerator / s.readinessDenominator) * 100) : 0);

  const signals = [];

  signals.push(buildNumericSignal({
    signalType: 'readiness', label: 'Readiness',
    currentValue: readinessPctOf(currentSnapshot),
    priorValues: priorSnapshotsOldestFirst.map(readinessPctOf),
    evidenceIds: [...priorSnapshotsOldestFirst.map((s) => s.id), currentSnapshot.id],
    explanationUnit: '%',
  }));

  signals.push(buildNumericSignal({
    signalType: 'constraint_pressure', label: 'Constraint Pressure',
    currentValue: currentSnapshot.unresolvedConstraintCount,
    priorValues: priorSnapshotsOldestFirst.map((s) => s.unresolvedConstraintCount),
    evidenceIds: [...priorSnapshotsOldestFirst.map((s) => s.id), currentSnapshot.id],
    explanationUnit: ' unresolved',
  }));

  if (currentSnapshot.activeOpportunityCount === null) {
    signals.push({
      signal: 'opportunity_access', label: 'Opportunity Access', currentState: null, comparisonState: null,
      trendClassification: 'unavailable',
      explanation: 'No requirement in this goal\'s real chain links to a capability, so opportunity access cannot be measured for this goal.',
      evidence: [currentSnapshot.id], availability: 'unavailable', historySufficiency: 0,
    });
  } else {
    signals.push(buildNumericSignal({
      signalType: 'opportunity_access', label: 'Opportunity Access',
      currentValue: currentSnapshot.activeOpportunityCount,
      priorValues: priorSnapshotsOldestFirst.filter((s) => s.activeOpportunityCount !== null).map((s) => s.activeOpportunityCount),
      evidenceIds: [...priorSnapshotsOldestFirst.map((s) => s.id), currentSnapshot.id],
      explanationUnit: ` of ${currentSnapshot.linkedCapabilityCount} linked capabilities available`,
    }));
  }

  signals.push(buildNumericSignal({
    signalType: 'capability_access', label: 'Capability Access',
    currentValue: currentSnapshot.capabilityAvailabilityCount,
    priorValues: priorSnapshotsOldestFirst.map((s) => s.capabilityAvailabilityCount),
    evidenceIds: [...priorSnapshotsOldestFirst.map((s) => s.id), currentSnapshot.id],
    explanationUnit: ` of ${currentSnapshot.capabilityTotalCount} real capabilities available (site-wide)`,
  }));

  // Priority/Focus is categorical, never numeric — no "trend" concept applies to it.
  const priorFocus = priorSnapshotsOldestFirst.length ? priorSnapshotsOldestFirst[priorSnapshotsOldestFirst.length - 1].currentFocusRequirementKey : undefined;
  let priorityExplanation;
  let priorityClassification;
  if (priorFocus === undefined) {
    priorityClassification = 'current_state_only';
    priorityExplanation = `Current priority: ${currentSnapshot.currentFocusRequirementKey || 'nothing unmet'} — no prior comparable observation exists yet.`;
  } else if (priorFocus === currentSnapshot.currentFocusRequirementKey) {
    priorityClassification = 'unchanged';
    priorityExplanation = `Priority remains "${currentSnapshot.currentFocusRequirementKey || 'nothing unmet'}" since the last observation.`;
  } else {
    priorityClassification = 'shifted';
    priorityExplanation = `Priority shifted from "${priorFocus || 'nothing unmet'}" to "${currentSnapshot.currentFocusRequirementKey || 'nothing unmet'}".`;
  }
  signals.push({
    signal: 'priority_focus', label: 'Priority / Focus',
    currentState: currentSnapshot.currentFocusRequirementKey, comparisonState: priorFocus === undefined ? null : priorFocus,
    trendClassification: priorityClassification, explanation: priorityExplanation,
    evidence: priorFocus === undefined ? [currentSnapshot.id] : [priorSnapshotsOldestFirst[priorSnapshotsOldestFirst.length - 1].id, currentSnapshot.id],
    availability: 'available', historySufficiency: priorSnapshotsOldestFirst.length,
  });

  return { signals, unavailableSignals: UNAVAILABLE_SIGNALS, currentSnapshotId: currentSnapshot.id, observedAt: currentSnapshot.observedAt };
}

// Orchestration: STALENESS discipline lives here — always captures
// (or dedupes against) a snapshot of the REAL CURRENT state before
// building Weather, so a caller never sees Weather built from a snapshot
// that's older than what CHEW can prove right now.
async function getEconomicWeather({ subjectId, goalId, reason }) {
  const { snapshot: current } = await captureSnapshot({ subjectId, goalId, reason: reason || 'manual_internal_snapshot' });
  const allSnapshots = await listSnapshots({ subjectId, goalId });
  const priorSnapshotsOldestFirst = allSnapshots.filter((s) => s.id !== current.id);
  return buildEconomicWeather(current, priorSnapshotsOldestFirst);
}

module.exports = {
  WEATHER_MODEL_VERSION, SNAPSHOT_REASONS, IMPLEMENTED_SNAPSHOT_REASONS, SIGNAL_TYPES, UNAVAILABLE_SIGNALS,
  captureSnapshot, getLatestSnapshot, listSnapshots, buildEconomicWeather, getEconomicWeather,
  computeCurrentStateFields, computeFingerprint, // exported for direct unit testing only
};
