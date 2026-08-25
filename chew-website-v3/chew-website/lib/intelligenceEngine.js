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

const { query } = require('./db');

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
      computedAt: null,
    };
  }

  const requirementsResult = await query(
    'SELECT * FROM transition_requirements WHERE transition_id = $1 ORDER BY sequence_order ASC',
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
    };
  } else {
    const evalEntry = evaluatedFacts[chosenRequirement.requirement_key];
    const currentDescription = evalEntry.value === null
      ? 'not yet provided'
      : `${evalEntry.value}${chosenRequirement.unit ? ' ' + chosenRequirement.unit : ''}`;
    const constraintNote = relevantConstraints.length
      ? ` CHEW also has ${relevantConstraints.length} unresolved constraint(s) on file for this transition.`
      : '';
    result = {
      subjectId,
      goalId,
      recommendedAction: chosenRequirement.action_if_unmet,
      rationale: `"${chosenRequirement.label}" is the highest-priority unmet requirement for "${goal.title}" `
        + `(sequence ${chosenRequirement.sequence_order}). Current: ${currentDescription}. `
        + `Required: ${chosenRequirement.required_value}${chosenRequirement.unit ? ' ' + chosenRequirement.unit : ''} `
        + `(${chosenRequirement.comparison}).${constraintNote}`,
      basedOnFacts: evaluatedFacts,
      basedOnConstraints,
      missingInformation: { missingFactKeys: missingKeys },
    };
  }

  const insertResult = await query(
    `INSERT INTO recommendations (subject_id, goal_id, recommended_action, rationale, based_on_facts, based_on_constraints, missing_information)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, computed_at`,
    [
      subjectId,
      goalId,
      result.recommendedAction,
      result.rationale,
      JSON.stringify(result.basedOnFacts),
      JSON.stringify(result.basedOnConstraints),
      JSON.stringify(result.missingInformation),
    ]
  );

  result.id = insertResult.rows[0].id;
  result.computedAt = insertResult.rows[0].computed_at;
  return result;
}

module.exports = { computeRecommendation, evaluateRequirement };
