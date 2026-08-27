// lib/frictionModel.js
//
// CHEW Friction Detection — the historical-PATTERN foundation (see
// FEATURE_FLAGS.md's "Friction Detection" section). Answers a fourth
// distinct question from the other intelligence foundations in this
// repo: not "what would change?" (Scenario Modeling), not "what's
// underused?" (Hidden Leverage), not "what's the current condition and
// how has it changed?" (Economic Weather), but "does the real history
// show the SAME structural blocker recurring, not just existing once?"
//
// CORE BOUNDARY — a constraint is something blocking progress NOW. A
// friction result is a PATTERN across multiple real, comparable
// observations. This file never calls one unresolved requirement
// "friction" — it requires at least two comparable material snapshots
// showing the same condition before it will say the word.
//
// NO NEW HISTORY TABLE. This reads ONLY real state_snapshots rows via
// weatherModel.listSnapshots() — the same real historical source of
// truth Economic Weather already established. It never queries the
// `scenarios` table and never imports createScenario/compareCrossGoalFutures/
// evaluateFactOverrideForGoal — a modeled hypothetical must never be
// able to count as a real observed recurrence, for the identical reason
// weatherModel.js itself never lets Scenario state leak into Weather.
//
// NO PSYCHOLOGY. This file's explanations are restricted to what the
// data can prove: a key remained unresolved, a focus repeated, a
// readiness fraction didn't move. It never says "procrastinating,"
// "avoiding," "unmotivated," "distracted," or any other human
// interpretation the data cannot support. Every explanation this file
// produces ends by naming what it does NOT know, not just what it does.
//
// NOT PERSISTED. Every result here is a pure derived computation over
// snapshots that already exist for another honest reason (Economic
// Weather's own state observation). There is no friction_items table —
// see FEATURE_FLAGS.md for why persistence was judged to add no real
// value this pass over deriving fresh from real history each time.

const { query } = require('./db');
const { listSnapshots } = require('./weatherModel');
const { getRequirementSequence } = require('./intelligenceEngine');

const FRICTION_MODEL_VERSION = 'friction-model-v1';

// Fixed, small vocabulary — only types this pass's real data can prove.
// persistent_opportunity_block is intentionally NOT implemented: a
// snapshot's capabilityCoverage stores counts (linked/available), not
// the specific documented blocking condition the directive requires
// before this type may fire honestly. Building it from counts alone
// would mean guessing a cause this schema doesn't actually store yet.
const FRICTION_TYPES = ['persistent_requirement', 'repeated_focus', 'readiness_stall', 'recurring_requirement'];

// Every result here is a fixed-rule computation over real observed
// state — never an inference, estimate, or guess. Reuses the exact
// 5-value vocabulary scenarios/leverage_items already use, rather than
// inventing a new one.
const CERTAINTY = 'deterministic';

const SEVERITY_LEVELS = ['persistent', 'repeated', 'recurring'];

// A real, named architectural limitation (not a TODO): this schema has
// no seasoning-period/waiting-condition data anywhere (no eligibility
// date, no scheduled-review field on transition_requirements). CHEW
// cannot currently tell a genuine waiting period apart from a real
// blocker. This hook exists so a future pass with real waiting-period
// data can suppress those cases without restructuring the engine — it
// always returns false today, honestly, rather than fabricating a
// distinction the schema cannot support.
function isKnownWaitingCondition(_requirementKey) {
  return false;
}

function daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

// "Spanning N days" rather than "a problem for N days" — this repo's
// snapshots are event-driven, not polled continuously, so large gaps
// between observations are real and must not be smoothed into a false
// claim of continuous observation.
function elapsedDescription(firstObservedAt, lastObservedAt) {
  const days = daysBetween(firstObservedAt, lastObservedAt);
  if (days <= 0) return 'within the same observed day';
  return `spanning ${days} day${days === 1 ? '' : 's'} of real observations`;
}

function severityForCount(count) {
  return count >= 3 ? 'repeated' : 'persistent';
}

function buildEvidence(snaps) {
  return snaps.map((s) => ({ snapshotId: s.id, observedAt: s.observedAt }));
}

// Defensive re-dedup by fingerprint — weatherModel already refuses to
// persist two consecutive identical snapshots, but this file must never
// silently trust a caller-supplied array and inflate an observation
// count from duplicates it didn't itself verify.
function materialSnapshots(snapshots) {
  const out = [];
  snapshots.forEach((s) => {
    const prev = out[out.length - 1];
    if (!prev || prev.stateFingerprint !== s.stateFingerprint) out.push(s);
  });
  return out;
}

// null = unknown (this key isn't present in this snapshot's real
// requirementState at all) — NEVER treated as met or unmet. Missing
// data must never collapse into "unresolved."
function requirementMetAt(snapshot, requirementKey) {
  const reqState = snapshot.rawStatePayload && snapshot.rawStatePayload.requirementState;
  if (!Array.isArray(reqState)) return null;
  const entry = reqState.find((r) => r.key === requirementKey);
  return entry ? !!entry.met : null;
}

// Every requirement key that appears in ANY material snapshot's real
// requirementState for this goal — not just the ones currently unmet.
function allRequirementKeysSeen(materialSnaps) {
  const keys = new Set();
  materialSnaps.forEach((s) => {
    const reqState = s.rawStatePayload && s.rawStatePayload.requirementState;
    if (Array.isArray(reqState)) reqState.forEach((r) => keys.add(r.key));
  });
  return Array.from(keys);
}

// Groups a requirement key's real per-snapshot met/unmet values into
// contiguous same-value runs, entirely SKIPPING snapshots where the key
// is unknown (not present) rather than letting an unknown gap silently
// bridge or break a run in a way this file can't actually prove.
function buildRuns(materialSnaps, requirementKey) {
  const known = materialSnaps
    .map((snap) => ({ snap, met: requirementMetAt(snap, requirementKey) }))
    .filter((x) => x.met !== null);

  const runs = [];
  known.forEach(({ snap, met }) => {
    const last = runs[runs.length - 1];
    if (last && last.met === met) last.snaps.push(snap);
    else runs.push({ met, snaps: [snap] });
  });
  return runs;
}

// persistent_requirement + recurring_requirement share one real-run
// analysis per requirement key, because they are genuinely the same
// underlying signal (a requirement's real unresolved/resolved history)
// classified differently depending on whether the data proves a single
// persisting block or an actual observed regression.
function analyzeRequirementTimeline(goalId, requirementKey, materialSnaps, labelsByKey) {
  if (isKnownWaitingCondition(requirementKey)) return [];

  const runs = buildRuns(materialSnaps, requirementKey);
  if (!runs.length) return [];

  const falseRuns = runs.filter((r) => r.met === false);
  const label = labelsByKey[requirementKey] || requirementKey;
  const results = [];

  // recurring_requirement: real regression only — requires an unmet
  // run, then a met run, then an unmet run again, all actually observed
  // (never inferred from a single snapshot pair).
  if (falseRuns.length >= 2) {
    const first = falseRuns[0];
    const mostRecent = falseRuns[falseRuns.length - 1];
    const lastRunOverall = runs[runs.length - 1];
    const currentStatus = lastRunOverall.met === false ? 'active' : 'resolved';
    const allEvidence = [].concat(...runs.map((r) => r.snaps));
    results.push({
      frictionType: 'recurring_requirement',
      goalId,
      sourceRequirementKey: requirementKey,
      sourceFactKey: requirementKey,
      requirementLabel: label,
      observationCount: allEvidence.length,
      persistenceCount: mostRecent.snaps.length,
      recurrenceCount: falseRuns.length,
      firstObservedAt: first.snaps[0].observedAt,
      lastObservedAt: allEvidence[allEvidence.length - 1].observedAt,
      currentStatus,
      severity: 'recurring',
      certainty: CERTAINTY,
      evidence: buildEvidence(allEvidence),
      explanation: `"${label}" was resolved and later became unresolved again — a real regression observed ${falseRuns.length} separate times across ${allEvidence.length} meaningful observations (${elapsedDescription(first.snaps[0].observedAt, allEvidence[allEvidence.length - 1].observedAt)}). CHEW sees the pattern. CHEW does not know why it regressed.`,
      whatChewDoesNotKnow: 'Why this requirement stopped being met after previously resolving.',
    });
  }

  // persistent_requirement: the run most recently ended (i.e. the LAST
  // run in the sequence) if it's an unmet run with >=2 observations —
  // active if that run is still open (goes to the latest material
  // snapshot), resolved if a met run follows it.
  const lastRun = runs[runs.length - 1];
  const secondToLastRun = runs.length >= 2 ? runs[runs.length - 2] : null;

  if (lastRun.met === false && lastRun.snaps.length >= 2) {
    // Only report as persistent_requirement (not double-counted with
    // recurring_requirement) when this is the FIRST time this key has
    // ever been seen unresolved in the real history available — i.e.
    // no earlier false run exists before it.
    if (falseRuns.length === 1) {
      results.push({
        frictionType: 'persistent_requirement',
        goalId,
        sourceRequirementKey: requirementKey,
        sourceFactKey: requirementKey,
        requirementLabel: label,
        observationCount: lastRun.snaps.length,
        persistenceCount: lastRun.snaps.length,
        firstObservedAt: lastRun.snaps[0].observedAt,
        lastObservedAt: lastRun.snaps[lastRun.snaps.length - 1].observedAt,
        currentStatus: 'active',
        severity: severityForCount(lastRun.snaps.length),
        certainty: CERTAINTY,
        evidence: buildEvidence(lastRun.snaps),
        explanation: `"${label}" has remained unresolved across ${lastRun.snaps.length} meaningful observations (${elapsedDescription(lastRun.snaps[0].observedAt, lastRun.snaps[lastRun.snaps.length - 1].observedAt)}).`,
        whatChewDoesNotKnow: 'Why this requirement remains unresolved.',
      });
    }
  } else if (lastRun.met === true && secondToLastRun && secondToLastRun.met === false && secondToLastRun.snaps.length >= 2 && falseRuns.length === 1) {
    // The requirement WAS persistent, then resolved — explainable
    // historically rather than silently disappearing.
    results.push({
      frictionType: 'persistent_requirement',
      goalId,
      sourceRequirementKey: requirementKey,
      sourceFactKey: requirementKey,
      requirementLabel: label,
      observationCount: secondToLastRun.snaps.length,
      persistenceCount: secondToLastRun.snaps.length,
      firstObservedAt: secondToLastRun.snaps[0].observedAt,
      lastObservedAt: secondToLastRun.snaps[secondToLastRun.snaps.length - 1].observedAt,
      currentStatus: 'resolved',
      severity: severityForCount(secondToLastRun.snaps.length),
      certainty: CERTAINTY,
      evidence: buildEvidence(secondToLastRun.snaps),
      explanation: `"${label}" remained unresolved across ${secondToLastRun.snaps.length} meaningful observations (${elapsedDescription(secondToLastRun.snaps[0].observedAt, secondToLastRun.snaps[secondToLastRun.snaps.length - 1].observedAt)}), then resolved.`,
      whatChewDoesNotKnow: 'Why this requirement remained unresolved for as long as it did.',
    });
  }

  return results;
}

// repeated_focus: the SAME current_focus_requirement_key across the
// tail run of consecutive material snapshots ending at the latest one.
// Distinct from persistent_requirement — a requirement can remain
// unresolved without being the current focus the whole time (an
// earlier-ordered requirement can regress and reclaim focus instead;
// see recurring_requirement above and FEATURE_FLAGS.md for the real
// scratch-test case that proves the two signals genuinely diverge).
function detectRepeatedFocus(goalId, materialSnaps, labelsByKey) {
  if (materialSnaps.length < 2) return [];
  const latest = materialSnaps[materialSnaps.length - 1];
  const focusKey = latest.currentFocusRequirementKey;
  if (!focusKey) return []; // nothing unmet right now — no focus to repeat

  const run = [];
  for (let i = materialSnaps.length - 1; i >= 0; i--) {
    if (materialSnaps[i].currentFocusRequirementKey !== focusKey) break;
    run.unshift(materialSnaps[i]);
  }
  if (run.length < 2) return [];

  const label = labelsByKey[focusKey] || focusKey;
  return [{
    frictionType: 'repeated_focus',
    goalId,
    sourceRequirementKey: focusKey,
    sourceFactKey: focusKey,
    requirementLabel: label,
    observationCount: run.length,
    persistenceCount: run.length,
    firstObservedAt: run[0].observedAt,
    lastObservedAt: run[run.length - 1].observedAt,
    currentStatus: 'active',
    severity: severityForCount(run.length),
    certainty: CERTAINTY,
    evidence: buildEvidence(run),
    explanation: `"${label}" has remained CHEW's current focus across ${run.length} meaningful observations with no different requirement taking its place (${elapsedDescription(run[0].observedAt, run[run.length - 1].observedAt)}).`,
    whatChewDoesNotKnow: 'Why this requirement has not moved despite remaining the priority.',
  }];
}

// readiness_stall: the real readiness fraction (resolved/total) has not
// moved across the tail run of consecutive MATERIAL snapshots — meaning
// something else genuinely changed (a new snapshot was captured for a
// real reason) while readiness specifically stayed flat.
function detectReadinessStall(goalId, materialSnaps) {
  if (materialSnaps.length < 2) return [];
  const latest = materialSnaps[materialSnaps.length - 1];
  const fraction = (s) => `${s.readinessNumerator}/${s.readinessDenominator}`;
  const target = fraction(latest);

  const run = [];
  for (let i = materialSnaps.length - 1; i >= 0; i--) {
    if (fraction(materialSnaps[i]) !== target) break;
    run.unshift(materialSnaps[i]);
  }
  if (run.length < 2) return [];

  const pct = latest.readinessDenominator ? Math.round((latest.readinessNumerator / latest.readinessDenominator) * 100) : 0;
  return [{
    frictionType: 'readiness_stall',
    goalId,
    sourceRequirementKey: null,
    sourceFactKey: null,
    requirementLabel: null,
    observationCount: run.length,
    persistenceCount: run.length,
    firstObservedAt: run[0].observedAt,
    lastObservedAt: run[run.length - 1].observedAt,
    currentStatus: 'active',
    severity: severityForCount(run.length),
    certainty: CERTAINTY,
    evidence: buildEvidence(run),
    explanation: `Readiness has remained at ${target} (${pct}%) across ${run.length} meaningful observations, even though the state changed enough elsewhere to record a new one each time (${elapsedDescription(run[0].observedAt, run[run.length - 1].observedAt)}).`,
    whatChewDoesNotKnow: 'What is preventing overall readiness from moving despite other real changes.',
  }];
}

// The one exported pure-ish function: real snapshots in, real friction
// results out. Never touches the scenarios table, never accepts a
// hypothetical, never emits a result below the minimum evidence
// threshold (2 comparable observations for every type here).
function detectFriction({ goalId, snapshots, labelsByKey }) {
  const materialSnaps = materialSnapshots(snapshots.slice().sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt)));
  const labels = labelsByKey || {};

  const results = [];
  allRequirementKeysSeen(materialSnaps).forEach((key) => {
    results.push(...analyzeRequirementTimeline(goalId, key, materialSnaps, labels));
  });
  results.push(...detectRepeatedFocus(goalId, materialSnaps, labels));
  results.push(...detectReadinessStall(goalId, materialSnaps));

  return results.map((r) => ({ ...r, modelVersion: FRICTION_MODEL_VERSION }));
}

// Orchestration: real goal status check (the only user-choice signal
// this schema actually supports — there is no separate "paused" status,
// only active/completed/abandoned; a completed or abandoned goal is
// never evaluated for friction, documented here rather than pretending
// this schema can tell a deliberate pause apart from abandonment).
async function getFrictionForGoal({ subjectId, goalId }) {
  const goalResult = await query('SELECT id, status FROM goals WHERE id = $1 AND subject_id = $2', [goalId, subjectId]);
  const goal = goalResult.rows[0];
  if (!goal) {
    throw new Error('Goal not found for this subject.');
  }
  if (goal.status !== 'active') {
    return { active: [], resolved: [], skipped: true, skippedReason: `Goal status is "${goal.status}", not "active" — friction is not evaluated for a goal the subject is no longer actively pursuing.` };
  }

  const snapshots = await listSnapshots({ subjectId, goalId });
  const requirementSequence = await getRequirementSequence(goalId);
  const labelsByKey = {};
  requirementSequence.forEach((r) => { labelsByKey[r.key] = r.label; });

  const results = detectFriction({ goalId, snapshots, labelsByKey });
  return {
    active: results.filter((r) => r.currentStatus === 'active'),
    resolved: results.filter((r) => r.currentStatus === 'resolved'),
    skipped: false,
    skippedReason: null,
    materialObservationCount: materialSnapshots(snapshots).length,
  };
}

module.exports = {
  FRICTION_MODEL_VERSION, FRICTION_TYPES, SEVERITY_LEVELS,
  detectFriction, getFrictionForGoal,
  materialSnapshots, requirementMetAt, isKnownWaitingCondition, // exported for direct unit testing only
};
