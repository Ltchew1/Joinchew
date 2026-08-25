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

const { query } = require('./db');
const { getRoutingRecommendation } = require('./capabilityGraph');

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

async function computeRecommendation({ subjectId, goalId }) {
  const goalResult = await query(
    'SELECT * FROM goals WHERE id = $1 AND subject_id = $2',
    [goalId, subjectId]
  );
  const goal = goalResult.rows[0];
  if (!goal) {
    throw new Error('Goal not found for this subject.');
  }

  if (!goal.transition_id) {
    return {
      subjectId,
      goalId,
      recommendedAction: null,
      rationale: 'This goal has no transition matched to it yet, so CHEW has no rules to reason from.',
      basedOnFacts: {},
      basedOnConstraints: [],
      missingInformation: { reason: 'no_transition_matched' },
      relatedCapability: null,
      chosenRequirementKey: null,
      computedAt: null,
    };
  }

  const requirementsResult = await query(
    `SELECT tr.*, c.slug AS capability_slug
     FROM transition_requirements tr
     LEFT JOIN capabilities c ON c.id = tr.capability_id
     WHERE tr.transition_id = $1
     ORDER BY tr.sequence_order ASC`,
    [goal.transition_id]
  );
  const requirements = requirementsResult.rows;

  if (requirements.length === 0) {
    return {
      subjectId,
      goalId,
      recommendedAction: null,
      rationale: 'No requirements are defined yet for this transition, so CHEW has nothing to evaluate against.',
      basedOnFacts: {},
      basedOnConstraints: [],
      missingInformation: { reason: 'no_requirements_defined' },
      relatedCapability: null,
      chosenRequirementKey: null,
      computedAt: null,
    };
  }

  const factsResult = await query(
    `SELECT DISTINCT ON (fact_key) fact_key, fact_value, fact_type, source_note, recorded_at
     FROM current_state_facts
     WHERE subject_id = $1
     ORDER BY fact_key, recorded_at DESC`,
    [subjectId]
  );
  const factsByKey = {};
  factsResult.rows.forEach((row) => { factsByKey[row.fact_key] = row; });

  const constraintsResult = await query(
    `SELECT * FROM constraints
     WHERE subject_id = $1 AND is_resolved = FALSE
       AND (goal_id = $2 OR blocks_transition_id = $3)`,
    [subjectId, goalId, goal.transition_id]
  );
  const relevantConstraints = constraintsResult.rows;

  const missingKeys = requirements
    .filter((r) => !(r.requirement_key in factsByKey))
    .map((r) => r.requirement_key);

  let chosenRequirement = null;
  const evaluatedFacts = {};
  for (const req of requirements) {
    const fact = factsByKey[req.requirement_key];
    const factValue = fact ? fact.fact_value : null;
    evaluatedFacts[req.requirement_key] = {
      value: factValue,
      factType: fact ? fact.fact_type : null,
      required: req.required_value,
      unit: req.unit,
      comparison: req.comparison,
      met: evaluateRequirement(req.comparison, factValue, req.required_value),
    };
    if (!chosenRequirement && !evaluateRequirement(req.comparison, factValue, req.required_value)) {
      chosenRequirement = req;
    }
  }

  const basedOnConstraints = relevantConstraints.map((c) => ({
    id: c.id,
    type: c.constraint_type,
    description: c.description,
  }));

  let result;
  if (!chosenRequirement) {
    result = {
      subjectId,
      goalId,
      recommendedAction: null,
      rationale: `Every known requirement for "${goal.title}" is currently met based on the facts on file. CHEW has no further rules-based next step to recommend for this transition.`,
      basedOnFacts: evaluatedFacts,
      basedOnConstraints,
      missingInformation: { missingFactKeys: missingKeys },
      relatedCapability: null,
      chosenRequirementKey: null,
    };
  } else {
    const evalEntry = evaluatedFacts[chosenRequirement.requirement_key];
    const currentDescription = evalEntry.value === null
      ? 'not yet provided'
      : `${evalEntry.value}${chosenRequirement.unit ? ' ' + chosenRequirement.unit : ''}`;
    const constraintNote = relevantConstraints.length
      ? ` CHEW also has ${relevantConstraints.length} unresolved constraint(s) on file for this transition.`
      : '';

    // Opportunity Engine wiring: the chosen requirement may name a real
    // capability. If so, ask the already-built, already-tested
    // capability registry what it actually knows — never invent an
    // answer here. Today this will almost always report
    // available: false with zero providers, honestly, because
    // network_providers is still empty.
    let relatedCapability = null;
    if (chosenRequirement.capability_slug) {
      relatedCapability = await getRoutingRecommendation({ capabilitySlug: chosenRequirement.capability_slug });
    }
    const capabilityNote = relatedCapability
      ? (relatedCapability.available
          ? ` CHEW found ${relatedCapability.providers.length} active provider(s) for the "${relatedCapability.capability.name}" capability this requirement maps to.`
          : ` This requirement maps to the "${relatedCapability.capability.name}" capability, but no active provider is available for it yet.`)
      : '';

    result = {
      subjectId,
      goalId,
      recommendedAction: chosenRequirement.action_if_unmet,
      rationale: `"${chosenRequirement.label}" is the highest-priority unmet requirement for "${goal.title}" `
        + `(sequence ${chosenRequirement.sequence_order}). Current: ${currentDescription}. `
        + `Required: ${chosenRequirement.required_value}${chosenRequirement.unit ? ' ' + chosenRequirement.unit : ''} `
        + `(${chosenRequirement.comparison}).${constraintNote}${capabilityNote}`,
      basedOnFacts: evaluatedFacts,
      basedOnConstraints,
      missingInformation: { missingFactKeys: missingKeys },
      relatedCapability,
      chosenRequirementKey: chosenRequirement.requirement_key,
    };
  }

  const insertResult = await query(
    `INSERT INTO recommendations (subject_id, goal_id, recommended_action, rationale, based_on_facts, based_on_constraints, missing_information, related_capability, chosen_requirement_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, computed_at`,
    [
      subjectId,
      goalId,
      result.recommendedAction,
      result.rationale,
      JSON.stringify(result.basedOnFacts),
      JSON.stringify(result.basedOnConstraints),
      JSON.stringify(result.missingInformation),
      result.relatedCapability ? JSON.stringify(result.relatedCapability) : null,
      result.chosenRequirementKey,
    ]
  );

  result.id = insertResult.rows[0].id;
  result.computedAt = insertResult.rows[0].computed_at;

  // Create or reuse a pending action for the chosen requirement, so
  // there's something a subject can actually mark complete — decision
  // loop step 8 ("record action"). Reuses an existing pending action for
  // the same subject+requirement rather than spawning a duplicate every
  // time the recommendation is recomputed against the same unmet gap.
  result.action = null;
  if (chosenRequirement) {
    const existingActionResult = await query(
      `SELECT id, description, status FROM actions
       WHERE subject_id = $1 AND transition_requirement_id = $2 AND status = 'pending'`,
      [subjectId, chosenRequirement.id]
    );
    if (existingActionResult.rows[0]) {
      await query('UPDATE actions SET recommendation_id = $1 WHERE id = $2', [result.id, existingActionResult.rows[0].id]);
      result.action = {
        id: existingActionResult.rows[0].id,
        description: existingActionResult.rows[0].description,
        status: existingActionResult.rows[0].status,
      };
    } else {
      const actionInsertResult = await query(
        `INSERT INTO actions (subject_id, goal_id, transition_requirement_id, recommendation_id, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, description, status`,
        [subjectId, goalId, chosenRequirement.id, result.id, chosenRequirement.action_if_unmet]
      );
      result.action = actionInsertResult.rows[0];
    }
  }

  return result;
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

module.exports = { computeRecommendation, evaluateRequirement, completeAction, listActions };
