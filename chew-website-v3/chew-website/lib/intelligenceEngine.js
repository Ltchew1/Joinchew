// lib/intelligenceEngine.js
//
// The MVP slice of the CHEW Intelligence System described in
// ARCHITECTURE.md: Goal + Current State + Constraint + Transition ->
// an explainable Recommended Next Action.
//
// This is a rules-driven comparison engine, not machine learning. Every
// recommendation cites the exact fact_key/value pairs and constraint
// ids it used (based_on_facts / based_on_constraints), and lists what's
// genuinely unknown (missing_information) rather than guessing. There
// is no confidence score anywhere in this file — see ARCHITECTURE.md
// §15 for why one should not be added without a real statistical basis.
//
// "Best next move" in this MVP means: the first transition_requirements
// row (by sequence_order) that current_state_facts doesn't satisfy.
// sequence_order is an author's stated priority, not a computed
// leverage score — see ARCHITECTURE.md's TransitionRequirement section.
//
// Opportunity Engine wiring (ARCHITECTURE.md §20 milestone): when the
// chosen unmet requirement names a capability_id, this re-uses
// lib/capabilityGraph.js's already-tested getRoutingRecommendation() to
// report real provider availability for it — never a second, invented
// data model. See db/schema.sql's "Opportunity Engine wiring" comment.
//
// Action/task tracking (ARCHITECTURE.md §20 milestone, Gap 7): every
// recommendation with a chosen unmet requirement creates or reuses a
// pending `actions` row. completeAction() below is the only place a
// completed action can turn into a new fact, and it only does so for
// boolean_true requirements — see db/schema.sql's "Action / Task
// tracking" comment for why a threshold requirement's action completion
// must NOT be treated as evidence of the new value.
//
// READING MUST NOT CHANGE INTELLIGENCE (see ARCHITECTURE.md's
// "Recommendation purity" doctrine, added after ARCHITECTURE_REVIEW.md
// found that this file used to write a new `recommendations` row on
// EVERY call, including from the public, unauthenticated
// api/intelligence-demo.js endpoint — real, measured state pollution).
// This file now draws a hard line between two different things that
// used to be one function:
//   computeRecommendation()  — PURE. Reads real state, derives the
//     current recommendation, writes nothing. Safe to call on every
//     page render / GET / dashboard refresh, unlimited times, with zero
//     side effects.
//   recordRecommendation()   — the ONE place that persists a
//     `recommendations` row (and creates/reuses its `actions` row) —
//     and only when the real recommendation state actually changed
//     since the last one persisted for this subject+goal (deduped by a
//     real state fingerprint, the same discipline weatherModel.js's
//     state_snapshots already use). Call this only from an explicit
//     command that legitimately changed real state (e.g.
//     api/intelligence-actions.js, after completeAction()) — never from
//     a read-only endpoint.
//
// deriveGoalState() below is also the single shared implementation of
// "given real facts + a real requirement chain, what's met, what's the
// readiness, what's the current focus" — the same rule
// scenario-engine.js's deriveState() already computes, reused here
// directly instead of this file maintaining its own second copy (see
// ARCHITECTURE_REVIEW.md §3a). lib/scenarioModel.js's
// buildBaselineSnapshot() calls the same scenario-engine.js function
// independently — both converge on one shared primitive rather than one
// importing the other, which would create a circular dependency
// (scenarioModel.js already imports FROM this file).

const { query } = require('./db');
const { getRoutingRecommendation } = require('./capabilityGraph');
const ChewScenarioEngine = require('../scenario-engine');
const { stableStringify } = require('./util');
const crypto = require('crypto');

// Tags the "first unmet transition_requirements row by sequence_order"
// rule itself, not the code that happens to implement it — bump this
// only if that rule's actual definition changes. Read by
// lib/scenarioModel.js so a persisted Scenario can record which real
// rule version it was evaluated against, without duplicating the rule.
const RULE_VERSION = 'requirement-sequence-v1';

// The real, ordered requirement chain for one goal's transition —
// shared by api/intelligence-demo.js (public) and lib/scenarioModel.js
// (internal) so there is exactly one query that defines "the chain,"
// not two copies that could quietly drift apart.
async function getRequirementSequence(goalId) {
  const sequenceResult = await query(
    `SELECT tr.id, tr.requirement_key, tr.label, tr.sequence_order, tr.action_if_unmet,
            tr.comparison, tr.required_value, tr.unit,
            c.slug AS capability_slug, c.name AS capability_name
     FROM transition_requirements tr
     JOIN goals g ON g.transition_id = tr.transition_id
     LEFT JOIN capabilities c ON c.id = tr.capability_id
     WHERE g.id = $1
     ORDER BY tr.sequence_order ASC`,
    [goalId]
  );
  return sequenceResult.rows.map((row) => ({
    id: row.id,
    key: row.requirement_key,
    label: row.label,
    sequenceOrder: row.sequence_order,
    actionIfUnmet: row.action_if_unmet,
    comparison: row.comparison,
    requiredValue: row.required_value,
    unit: row.unit,
    capabilitySlug: row.capability_slug,
    capabilityName: row.capability_name,
  }));
}

// The real current facts for one subject, keyed by fact_key — the
// canonical single query, reused by lib/scenarioModel.js instead of
// that file keeping its own byte-identical private copy.
async function getFactsMap(subjectId) {
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

function evaluateRequirement(comparison, factValue, requiredValue) {
  if (factValue === undefined || factValue === null) return false;
  switch (comparison) {
    case 'boolean_true':
      return String(factValue).trim().toLowerCase() === 'true';
    case 'eq':
      return String(factValue).trim().toLowerCase() === String(requiredValue).trim().toLowerCase();
    case 'gte':
    case 'lte': {
      const factNum = parseFloat(factValue);
      const reqNum = parseFloat(requiredValue);
      if (Number.isNaN(factNum) || Number.isNaN(reqNum)) return false;
      return comparison === 'gte' ? factNum >= reqNum : factNum <= reqNum;
    }
    default:
      return false;
  }
}

// Pure derivation: real goal + real facts + real requirement chain ->
// requirement state, readiness, current focus, related capability,
// unresolved constraints. NEVER writes to the database. This is the
// single implementation lib/scenarioModel.js's buildBaselineSnapshot()
// also converges on, via the same scenario-engine.js primitive —
// see this file's header comment for why neither module imports the
// other's assembly function directly.
async function deriveGoalState({ subjectId, goalId }) {
  const goalResult = await query('SELECT * FROM goals WHERE id = $1 AND subject_id = $2', [goalId, subjectId]);
  const goal = goalResult.rows[0];
  if (!goal) {
    throw new Error('Goal not found for this subject.');
  }

  const empty = {
    goal, requirementSequence: [], factsByKey: {},
    state: { total: 0, resolvedCount: 0, chosenKey: null, perRequirement: [] },
    chosenReq: null, relatedCapability: null, missingFactKeys: [], constraints: [],
  };

  if (!goal.transition_id) return { ...empty, hasTransition: false };

  const requirementSequence = await getRequirementSequence(goalId);
  if (requirementSequence.length === 0) return { ...empty, hasTransition: true };

  const factsByKey = await getFactsMap(subjectId);
  const missingFactKeys = requirementSequence.filter((r) => !(r.key in factsByKey)).map((r) => r.key);

  const resolvedMap = {};
  requirementSequence.forEach((r) => {
    const fact = factsByKey[r.key];
    resolvedMap[r.key] = evaluateRequirement(r.comparison, fact ? fact.fact_value : null, r.requiredValue);
  });
  const state = ChewScenarioEngine.deriveState(requirementSequence, resolvedMap);

  const constraintsResult = await query(
    `SELECT id, constraint_type, description FROM constraints
     WHERE subject_id = $1 AND is_resolved = FALSE AND (goal_id = $2 OR blocks_transition_id = $3)`,
    [subjectId, goalId, goal.transition_id]
  );

  const chosenReq = requirementSequence.find((r) => r.key === state.chosenKey) || null;
  // Opportunity Engine wiring: the chosen requirement may name a real
  // capability. If so, ask the already-built, already-tested capability
  // registry what it actually knows — never invent an answer here.
  let relatedCapability = null;
  if (chosenReq && chosenReq.capabilitySlug) {
    relatedCapability = await getRoutingRecommendation({ capabilitySlug: chosenReq.capabilitySlug });
  }

  return {
    goal, hasTransition: true, requirementSequence, factsByKey, state,
    chosenReq, relatedCapability, missingFactKeys, constraints: constraintsResult.rows,
  };
}

// Pure: shapes already-derived state into the public recommendation
// contract every caller (api/intelligence-demo.js, the HTML rooms,
// api/intelligence-recommendation.js) already depends on — field names
// and rationale text unchanged from before this refactor.
function shapeRecommendation(derived, { subjectId, goalId }) {
  const { goal } = derived;

  if (!derived.hasTransition) {
    return {
      subjectId, goalId, recommendedAction: null,
      rationale: 'This goal has no transition matched to it yet, so CHEW has no rules to reason from.',
      basedOnFacts: {}, basedOnConstraints: [],
      missingInformation: { reason: 'no_transition_matched' },
      relatedCapability: null, chosenRequirementKey: null,
    };
  }
  if (derived.requirementSequence.length === 0) {
    return {
      subjectId, goalId, recommendedAction: null,
      rationale: 'No requirements are defined yet for this transition, so CHEW has nothing to evaluate against.',
      basedOnFacts: {}, basedOnConstraints: [],
      missingInformation: { reason: 'no_requirements_defined' },
      relatedCapability: null, chosenRequirementKey: null,
    };
  }

  const evaluatedFacts = {};
  derived.requirementSequence.forEach((r) => {
    const perReq = derived.state.perRequirement.find((p) => p.key === r.key);
    const fact = derived.factsByKey[r.key];
    evaluatedFacts[r.key] = {
      value: fact ? fact.fact_value : null,
      factType: fact ? fact.fact_type : null,
      required: r.requiredValue,
      unit: r.unit,
      comparison: r.comparison,
      met: perReq ? perReq.met : false,
    };
  });
  const basedOnConstraints = derived.constraints.map((c) => ({ id: c.id, type: c.constraint_type, description: c.description }));
  const { chosenReq, relatedCapability } = derived;

  if (!chosenReq) {
    return {
      subjectId, goalId, recommendedAction: null,
      rationale: `Every known requirement for "${goal.title}" is currently met based on the facts on file. CHEW has no further rules-based next step to recommend for this transition.`,
      basedOnFacts: evaluatedFacts, basedOnConstraints,
      missingInformation: { missingFactKeys: derived.missingFactKeys },
      relatedCapability: null, chosenRequirementKey: null,
    };
  }

  const evalEntry = evaluatedFacts[chosenReq.key];
  const currentDescription = evalEntry.value === null ? 'not yet provided' : `${evalEntry.value}${chosenReq.unit ? ' ' + chosenReq.unit : ''}`;
  const constraintNote = derived.constraints.length
    ? ` CHEW also has ${derived.constraints.length} unresolved constraint(s) on file for this transition.`
    : '';
  const capabilityNote = relatedCapability
    ? (relatedCapability.available
        ? ` CHEW found ${relatedCapability.providers.length} active provider(s) for the "${relatedCapability.capability.name}" capability this requirement maps to.`
        : ` This requirement maps to the "${relatedCapability.capability.name}" capability, but no active provider is available for it yet.`)
    : '';

  return {
    subjectId, goalId,
    recommendedAction: chosenReq.actionIfUnmet,
    rationale: `"${chosenReq.label}" is the highest-priority unmet requirement for "${goal.title}" `
      + `(sequence ${chosenReq.sequenceOrder}). Current: ${currentDescription}. `
      + `Required: ${chosenReq.requiredValue}${chosenReq.unit ? ' ' + chosenReq.unit : ''} `
      + `(${chosenReq.comparison}).${constraintNote}${capabilityNote}`,
    basedOnFacts: evaluatedFacts, basedOnConstraints,
    missingInformation: { missingFactKeys: derived.missingFactKeys },
    relatedCapability, chosenRequirementKey: chosenReq.key,
  };
}

// PURE. Reads real state, derives the current recommendation, writes
// NOTHING — safe to call from any GET/read path, any number of times,
// including the public api/intelligence-demo.js endpoint. See this
// file's header "READING MUST NOT CHANGE INTELLIGENCE" doctrine.
async function computeRecommendation({ subjectId, goalId }) {
  const derived = await deriveGoalState({ subjectId, goalId });
  return shapeRecommendation(derived, { subjectId, goalId });
}

// The exact fields that define WHAT is being recommended and why —
// deliberately excludes anything volatile (timestamps, row ids).
// Mirrors lib/weatherModel.js's state_snapshots fingerprinting exactly,
// reusing the same stableStringify() + sha256 approach rather than
// inventing a third one.
function recommendationFingerprintFields(recommendation) {
  return {
    chosenRequirementKey: recommendation.chosenRequirementKey,
    recommendedAction: recommendation.recommendedAction,
    missingFactKeys: (recommendation.missingInformation && recommendation.missingInformation.missingFactKeys) || null,
    missingReason: (recommendation.missingInformation && recommendation.missingInformation.reason) || null,
    constraintIds: recommendation.basedOnConstraints.map((c) => c.id).sort((a, b) => a - b),
    relatedCapabilityAvailable: recommendation.relatedCapability ? recommendation.relatedCapability.available : null,
    relatedCapabilityProviderCount: recommendation.relatedCapability ? recommendation.relatedCapability.providers.length : null,
  };
}

function computeRecommendationFingerprint(recommendation) {
  return crypto.createHash('sha256').update(stableStringify(recommendationFingerprintFields(recommendation))).digest('hex');
}

async function getLatestRecommendation({ subjectId, goalId }) {
  const result = await query(
    `SELECT * FROM recommendations WHERE subject_id = $1 AND goal_id = $2 ORDER BY computed_at DESC LIMIT 1`,
    [subjectId, goalId]
  );
  return result.rows[0] || null;
}

async function findPendingAction({ subjectId, transitionRequirementId }) {
  const result = await query(
    `SELECT id, description, status FROM actions WHERE subject_id = $1 AND transition_requirement_id = $2 AND status = 'pending'`,
    [subjectId, transitionRequirementId]
  );
  return result.rows[0] || null;
}

// THE ONE FUNCTION IN THIS FILE THAT WRITES TO `recommendations` OR
// `actions`. Computes the current recommendation (pure, via
// computeRecommendation()'s own logic) and persists a new history row
// ONLY when the real recommendation state has actually changed since
// the last one recorded for this subject+goal — deduped by a real
// fingerprint, never a blind insert. Call this from an explicit command
// that legitimately changed real state (e.g. api/intelligence-actions.js,
// after completeAction()) — never from a read-only endpoint. See this
// file's header doctrine and ARCHITECTURE.md's "Recommendation purity"
// section for why this split exists.
async function recordRecommendation({ subjectId, goalId }) {
  const derived = await deriveGoalState({ subjectId, goalId });
  const recommendation = shapeRecommendation(derived, { subjectId, goalId });
  const fingerprint = computeRecommendationFingerprint(recommendation);
  const chosenReq = derived.chosenReq;

  const latest = await getLatestRecommendation({ subjectId, goalId });
  if (latest && latest.state_fingerprint === fingerprint) {
    const action = chosenReq ? await findPendingAction({ subjectId, transitionRequirementId: chosenReq.id }) : null;
    return {
      recommendation: {
        ...recommendation, id: latest.id, computedAt: latest.computed_at,
        ruleVersion: latest.rule_version, stateFingerprint: latest.state_fingerprint,
      },
      action, wasNew: false,
    };
  }

  const insertResult = await query(
    `INSERT INTO recommendations
       (subject_id, goal_id, recommended_action, rationale, based_on_facts, based_on_constraints,
        missing_information, related_capability, chosen_requirement_key, state_fingerprint, rule_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, computed_at, rule_version, state_fingerprint`,
    [
      subjectId, goalId, recommendation.recommendedAction, recommendation.rationale,
      JSON.stringify(recommendation.basedOnFacts), JSON.stringify(recommendation.basedOnConstraints),
      JSON.stringify(recommendation.missingInformation),
      recommendation.relatedCapability ? JSON.stringify(recommendation.relatedCapability) : null,
      recommendation.chosenRequirementKey, fingerprint, RULE_VERSION,
    ]
  );
  const persisted = insertResult.rows[0];

  // Create or reuse a pending action for the chosen requirement, so
  // there's something a subject can actually mark complete — decision
  // loop step 8 ("record action"). Only touched here, on a genuine new
  // history row — never on a read that changed nothing.
  let action = null;
  if (chosenReq) {
    const existing = await findPendingAction({ subjectId, transitionRequirementId: chosenReq.id });
    if (existing) {
      await query('UPDATE actions SET recommendation_id = $1 WHERE id = $2', [persisted.id, existing.id]);
      action = existing;
    } else {
      const actionInsertResult = await query(
        `INSERT INTO actions (subject_id, goal_id, transition_requirement_id, recommendation_id, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, description, status`,
        [subjectId, goalId, chosenReq.id, persisted.id, chosenReq.actionIfUnmet]
      );
      action = actionInsertResult.rows[0];
    }
  }

  return {
    recommendation: {
      ...recommendation, id: persisted.id, computedAt: persisted.computed_at,
      ruleVersion: persisted.rule_version, stateFingerprint: persisted.state_fingerprint,
    },
    action, wasNew: true,
  };
}

// Marks a pending action completed. A boolean_true requirement's
// completion is always treated as evidence of the fact itself (the
// action IS the fact — see db/schema.sql). A threshold requirement
// (gte/lte/eq) is never inferred from activity alone: the caller MUST
// supply `factValue` — the subject's own report of the resulting number
// — to complete it, recorded as `user_provided`, exactly as trustworthy
// (no more, no less) as any other self-reported fact.
//
// `factValue` is required, not optional-with-a-fallback-guidance, for a
// deliberate reason: an action can only be completed once (its status
// check below refuses a second attempt), so a completion that silently
// accepted "no value" would leave the action permanently done with
// nothing to show for it and no way to retry — a real dead end. An
// action linked to a threshold requirement stays `pending` (and
// completable again) until a real value is actually provided.
async function completeAction({ actionId, subjectId, factValue }) {
  const actionResult = await query(
    'SELECT * FROM actions WHERE id = $1 AND subject_id = $2',
    [actionId, subjectId]
  );
  const action = actionResult.rows[0];
  if (!action) {
    throw new Error('Action not found for this subject.');
  }
  if (action.status !== 'pending') {
    throw new Error(`Action is already ${action.status}, not pending.`);
  }

  let requirement = null;
  if (action.transition_requirement_id) {
    const reqResult = await query(
      'SELECT * FROM transition_requirements WHERE id = $1',
      [action.transition_requirement_id]
    );
    requirement = reqResult.rows[0] || null;
  }

  const hasFactValue = factValue !== undefined && factValue !== null && String(factValue).trim() !== '';

  // Validate before writing anything — a bad or missing factValue must
  // fail the whole call, leaving the action pending, not half-completed.
  if (requirement && requirement.comparison !== 'boolean_true' && !hasFactValue) {
    throw new Error(
      `factValue is required to complete this action — completing the activity alone doesn't tell CHEW `
      + `your new value for "${requirement.label}".`
    );
  }
  if (requirement && hasFactValue && (requirement.comparison === 'gte' || requirement.comparison === 'lte')
      && Number.isNaN(parseFloat(factValue))) {
    throw new Error(`factValue must be numeric for a "${requirement.comparison}" requirement.`);
  }

  let resultingFactId = null;
  let factCreated = false;
  let guidance = null;

  if (requirement && requirement.comparison === 'boolean_true') {
    const factInsertResult = await query(
      `INSERT INTO current_state_facts (subject_id, fact_key, fact_value, fact_type, source_note)
       VALUES ($1, $2, 'true', 'user_provided', $3)
       RETURNING id`,
      [subjectId, requirement.requirement_key, `Self-reported by completing action #${action.id}.`]
    );
    resultingFactId = factInsertResult.rows[0].id;
    factCreated = true;
  } else if (requirement) {
    // hasFactValue is guaranteed true here — the guard above already
    // rejected the missing/invalid cases.
    const factInsertResult = await query(
      `INSERT INTO current_state_facts (subject_id, fact_key, fact_value, fact_type, source_note)
       VALUES ($1, $2, $3, 'user_provided', $4)
       RETURNING id`,
      [subjectId, requirement.requirement_key, String(factValue).trim(), `Self-reported by completing action #${action.id}.`]
    );
    resultingFactId = factInsertResult.rows[0].id;
    factCreated = true;
  } else {
    guidance = 'This action has no linked requirement, so completing it does not update any stored fact.';
  }

  await query(
    'UPDATE actions SET status = $1, completed_at = now(), resulting_fact_id = $2 WHERE id = $3',
    ['completed', resultingFactId, action.id]
  );

  return {
    actionId: action.id,
    goalId: action.goal_id,
    status: 'completed',
    factCreated,
    resultingFactId,
    guidance,
  };
}

async function listActions({ subjectId, status }) {
  const params = [subjectId];
  let sql = 'SELECT * FROM actions WHERE subject_id = $1';
  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  sql += ' ORDER BY created_at DESC';
  const result = await query(sql, params);
  return result.rows.map((row) => ({
    id: row.id,
    goalId: row.goal_id,
    transitionRequirementId: row.transition_requirement_id,
    recommendationId: row.recommendation_id,
    description: row.description,
    status: row.status,
    resultingFactId: row.resulting_fact_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

module.exports = {
  computeRecommendation, recordRecommendation, evaluateRequirement, completeAction, listActions,
  getRequirementSequence, getFactsMap, deriveGoalState, RULE_VERSION,
  getLatestRecommendation, computeRecommendationFingerprint, // exported for direct unit testing only
};
