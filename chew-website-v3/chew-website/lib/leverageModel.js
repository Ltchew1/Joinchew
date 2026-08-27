// lib/leverageModel.js
//
// The CHEW Hidden Leverage Foundation (see FEATURE_FLAGS.md and
// db/schema.sql's "Hidden Leverage Foundation" section). Answers a
// different question than lib/scenarioModel.js: not "what would change
// if I moved this fact?" but "what already exists in the subject's real
// data that could help a goal, but is underused or unconnected?"
//
// Hard rule this whole file exists to enforce: every leverage item must
// be traceable to real stored evidence — a real fact, a real
// requirement it satisfies, a real human-authored goal_conflict_rules
// row, or a real capability link. There is no LLM call anywhere in this
// file, no brainstorming step, and no fallback that invents an asset,
// relationship, program, or provider this schema doesn't actually
// contain. A detector that can't point to real evidence returns
// nothing — it never returns a plausible-sounding guess.
//
// Deliberately not built on the scenarios table: a leverage item has no
// baseline/proposed-move/effects shape, because it isn't modeling a
// hypothetical change — it's pointing at something real that already
// exists. See db/schema.sql's comment on leverage_items for why forcing
// this into the Scenario shape was explicitly rejected.
//
// Identity boundary: identical in spirit to lib/scenarioModel.js — this
// file only ever operates against the one seeded illustrative
// intel_subjects row, and leverage_items.subject_type's CHECK blocks a
// 'member' row at the database level regardless of what this file does.

const { query } = require('./db');
const { evaluateRequirement, getRequirementSequence } = require('./intelligenceEngine');
const { listConflictRulesForGoal } = require('./scenarioModel');
const { getCapabilityOverview } = require('./capabilityGraph');
const { stableStringify, LEVERAGE_UNCERTAINTY_CLASSES, flipToStaleOnce } = require('./util');

const LEVERAGE_MODEL_VERSION = 'leverage-model-v1';

const SOURCE_TYPES = ['fact', 'capability', 'conflict_rule'];
// Which source types have a real, implemented detector as of this pass.
// Deliberately smaller than SOURCE_TYPES — see discoverBySourceType().
const IMPLEMENTED_SOURCE_TYPES = ['fact', 'capability'];

const LEVERAGE_CATEGORIES = ['reusable_requirement', 'multi_goal_fact', 'dormant_capability', 'underused_resource', 'duplicate_effort_avoided'];
const VERIFICATION_STATES = ['user_provided', 'verified', 'computed', 'inferred']; // identical to current_state_facts.fact_type — reused, not reinvented
const ACTIVATION_STATUSES = ['discovered', 'available', 'needs_verification', 'needs_action', 'already_activated', 'unavailable', 'stale'];
const EXPECTED_EFFECT_TYPES = ['supports_multiple_goals', 'reduces_duplicate_effort', 'unlocks_capability'];
// Adds 'editorial' relative to scenarioModel.js's UNCERTAINTY_CLASSES —
// a leverage item built on a declared-but-not-stored editorial mapping
// (the Wealth World CAP_TERRITORIES pattern) must be distinguishable
// from one built on a real stored rule. No leverage item this pass
// actually uses 'editorial' — the one real item is backed by a stored
// goal_conflict_rules row, so it's classified 'assumption_dependent',
// inherited directly from that rule's own certainty — but the value
// exists for when an editorial-mapping-backed detector is built later.
// One authoritative JS definition now lives in lib/util.js — see
// ARCHITECTURE_REVIEW.md §3b. Kept under this file's existing exported
// name so nothing downstream needed to change.
const UNCERTAINTY_CLASSES = LEVERAGE_UNCERTAINTY_CLASSES;

function rowToLeverageItem(row) {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectRef: row.subject_ref,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    leverageCategory: row.leverage_category,
    title: row.title,
    description: row.description,
    relatedGoalIds: row.related_goal_ids,
    relatedConstraintIds: row.related_constraint_ids,
    relatedOpportunityIds: row.related_opportunity_ids,
    relatedCapabilityIds: row.related_capability_ids,
    applicabilityRule: row.applicability_rule,
    evidence: row.evidence,
    verificationState: row.verification_state,
    activationStatus: row.activation_status,
    suggestedAction: row.suggested_action,
    expectedEffectType: row.expected_effect_type,
    uncertaintyClassification: row.uncertainty_classification,
    modelVersion: row.model_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  };
}

// A fact is only trustworthy as leverage to the same degree it's
// trustworthy anywhere else on this site — a self-reported
// ('user_provided') fact needs independent verification before CHEW
// calls it fully "available," even though it already satisfies a real
// requirement today. Never invents a status the fact's own record
// doesn't support.
function activationStatusForFactType(factType) {
  return factType === 'verified' ? 'available' : 'needs_verification';
}

// Idempotent: the same real evidence (subject + source + category) can
// only ever produce one row, enforced by both this check AND the
// database's own unique index (uniq_leverage_items_evidence) — belt and
// suspenders, not either/or. If the evidence has drifted since the row
// was created, this flips activation_status to 'stale' and updates
// nothing else — the stored description/evidence/suggestedAction are
// never silently recomputed, exactly like a stale Scenario.
async function findOrCreateLeverageItem(fields) {
  const existingResult = await query(
    `SELECT * FROM leverage_items WHERE subject_ref = $1 AND source_type = $2 AND source_ref = $3 AND leverage_category = $4`,
    [fields.subjectId, fields.sourceType, fields.sourceRef, fields.leverageCategory]
  );
  const existing = existingResult.rows[0];
  if (existing) {
    const evidenceMatches = stableStringify(existing.evidence) === stableStringify(fields.evidence);
    if (evidenceMatches) {
      const touched = await query(
        `UPDATE leverage_items SET last_verified_at = now() WHERE id = $1 RETURNING *`,
        [existing.id]
      );
      return rowToLeverageItem(touched.rows[0]);
    }
    let updated = existing;
    await flipToStaleOnce({
      alreadyStale: existing.activation_status === 'stale',
      markStale: async () => {
        const staled = await query(
          `UPDATE leverage_items SET activation_status = 'stale', updated_at = now() WHERE id = $1 RETURNING *`,
          [existing.id]
        );
        updated = staled.rows[0];
      },
    });
    return rowToLeverageItem(updated);
  }

  const insertResult = await query(
    `INSERT INTO leverage_items
       (subject_type, subject_ref, source_type, source_ref, leverage_category, title, description,
        related_goal_ids, related_constraint_ids, related_opportunity_ids, related_capability_ids,
        applicability_rule, evidence, verification_state, activation_status, suggested_action,
        expected_effect_type, uncertainty_classification, model_version, last_verified_at)
     VALUES ('illustrative', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
     RETURNING *`,
    [
      fields.subjectId, fields.sourceType, fields.sourceRef, fields.leverageCategory, fields.title, fields.description,
      JSON.stringify(fields.relatedGoalIds), JSON.stringify(fields.relatedConstraintIds),
      JSON.stringify(fields.relatedOpportunityIds), JSON.stringify(fields.relatedCapabilityIds),
      fields.applicabilityRule, JSON.stringify(fields.evidence), fields.verificationState, fields.activationStatus,
      fields.suggestedAction, fields.expectedEffectType, fields.uncertaintyClassification, LEVERAGE_MODEL_VERSION,
    ]
  );
  return rowToLeverageItem(insertResult.rows[0]);
}

// Shared by discoverMultiGoalFactLeverage() and
// discoverDormantCapabilityLeverage() — these two used to carry
// near-identical inline copies of this exact loop (see
// ARCHITECTURE_REVIEW.md §3c). A previously-found item whose source_ref
// is no longer in THIS run's fresh result set (the fact stopped
// satisfying its requirement, the capability lost its provider, the
// rule was deactivated, whatever the caller's own discovery just
// re-verified) is never silently left looking current.
// already_activated is a leverage-item-specific extra guard beyond mere
// staleness — a subject who already acted on this item shouldn't have
// it retroactively relabeled just because the underlying evidence later
// stopped holding.
async function sweepStaleLeverageItems({ subjectId, sourceType, leverageCategory, currentSourceRefs }) {
  const existingResult = await query(
    `SELECT id, source_ref, activation_status FROM leverage_items WHERE subject_ref = $1 AND source_type = $2 AND leverage_category = $3`,
    [subjectId, sourceType, leverageCategory]
  );
  for (const row of existingResult.rows) {
    if (currentSourceRefs.has(row.source_ref)) continue;
    if (row.activation_status === 'already_activated') continue;
    // eslint-disable-next-line no-await-in-loop -- small, bounded set of previously-discovered items for one subject.
    await flipToStaleOnce({
      alreadyStale: row.activation_status === 'stale',
      markStale: () => query(`UPDATE leverage_items SET activation_status = 'stale', updated_at = now() WHERE id = $1`, [row.id]),
    });
  }
}

async function getFactsWithIds(subjectId) {
  const result = await query(
    `SELECT DISTINCT ON (fact_key) id, fact_key, fact_value, fact_type, source_note, recorded_at
     FROM current_state_facts WHERE subject_id = $1 ORDER BY fact_key, recorded_at DESC`,
    [subjectId]
  );
  return result.rows;
}

async function getActiveGoals(subjectId) {
  const result = await query(`SELECT * FROM goals WHERE subject_id = $1 AND status = 'active' ORDER BY id ASC`, [subjectId]);
  return result.rows;
}

// The strongest, most literal form of "reuse value": one real fact that
// is, by itself, a requirement_key in more than one active goal's own
// real chain — no declared rule even needed, since the schema itself
// says both goals read the identical fact. Implemented as a genuine
// code path even though it currently finds nothing for this repo's real
// seed data (no fact_key is shared verbatim across the two seeded
// goals' chains) — proven empty by test, not assumed empty.
async function findDirectlySharedFacts(subjectId, goals, factsByKeyWithId) {
  const chains = await Promise.all(goals.map(async (g) => ({ goal: g, sequence: await getRequirementSequence(g.id) })));
  const results = [];
  Object.values(factsByKeyWithId).forEach((fact) => {
    const satisfyingGoals = chains.filter(({ sequence }) => {
      const req = sequence.find((r) => r.key === fact.fact_key);
      return req && evaluateRequirement(req.comparison, fact.fact_value, req.requiredValue);
    });
    if (satisfyingGoals.length > 1) results.push({ fact, satisfyingGoals: satisfyingGoals.map((s) => s.goal) });
  });
  return results;
}

// The declared-rule form of multi-goal reuse: a fact satisfies its own
// goal's real requirement, AND a human has explicitly declared (via
// goal_conflict_rules — the exact same authorization point Conflict
// Detection uses) that this same fact also matters to a second real
// goal. This is the one real leverage case this repo's seed data can
// currently prove.
async function discoverMultiGoalFactLeverage(subjectId) {
  const goals = await getActiveGoals(subjectId);
  if (goals.length === 0) return [];

  const facts = await getFactsWithIds(subjectId);
  const factsByKey = {};
  facts.forEach((f) => { factsByKey[f.fact_key] = f; });

  const chains = {};
  for (const g of goals) {
    // eslint-disable-next-line no-await-in-loop -- small, bounded goal list; sequential reads keep this readable and match the rest of this file's style.
    chains[g.id] = await getRequirementSequence(g.id);
  }

  const items = [];
  for (const goal of goals) {
    const sequence = chains[goal.id];
    for (const req of sequence) {
      const fact = factsByKey[req.key];
      if (!fact) continue;
      const met = evaluateRequirement(req.comparison, fact.fact_value, req.requiredValue);
      if (!met) continue; // only an already-satisfied requirement counts as "already established"

      // eslint-disable-next-line no-await-in-loop -- bounded by real requirement count per goal (2-3 today).
      const rules = await listConflictRulesForGoal(goal.id);
      const matchingRule = rules.find((r) => r.sharedFactKey === req.key);
      if (!matchingRule) continue; // no declared relationship — CHEW does not infer one

      const otherGoalId = matchingRule.goalAId === goal.id ? matchingRule.goalBId : matchingRule.goalAId;
      const otherGoal = goals.find((g) => g.id === otherGoalId);
      const otherGoalTitle = otherGoal ? otherGoal.title : `goal ${otherGoalId}`;

      const evidence = {
        factId: fact.id,
        factKey: fact.fact_key,
        factValue: fact.fact_value,
        factType: fact.fact_type,
        satisfiesRequirementKey: req.key,
        satisfiesGoalId: goal.id,
        conflictRuleId: matchingRule.id,
        declaredOtherGoalId: otherGoalId,
      };

      // eslint-disable-next-line no-await-in-loop -- persistence must happen per-item to enforce the unique-evidence constraint per row, not batched.
      const item = await findOrCreateLeverageItem({
        subjectId,
        sourceType: 'fact',
        sourceRef: fact.id,
        leverageCategory: 'multi_goal_fact',
        title: `"${req.label}" is already established and declared relevant to more than one goal`,
        description: `The real fact "${fact.fact_key}" already satisfies "${goal.title}"'s real "${req.label}" requirement, `
          + `and goal_conflict_rules #${matchingRule.id} explicitly declares this same fact also matters to `
          + `"${otherGoalTitle}" — ${matchingRule.mechanism}`,
        relatedGoalIds: [goal.id, otherGoalId],
        relatedConstraintIds: [],
        relatedOpportunityIds: [],
        relatedCapabilityIds: [],
        applicabilityRule: `goal_conflict_rules #${matchingRule.id} declares shared_fact_key="${req.key}" between goal ${matchingRule.goalAId} `
          + `and goal ${matchingRule.goalBId}; the real current_state_facts row (id ${fact.id}) satisfies goal ${goal.id}'s real `
          + `"${req.label}" requirement via evaluateRequirement('${req.comparison}', '${fact.fact_value}', '${req.requiredValue}').`,
        evidence,
        verificationState: fact.fact_type,
        activationStatus: activationStatusForFactType(fact.fact_type),
        suggestedAction: `Preserve or update this same evidence rather than re-establishing it separately if pursuing `
          + `"${otherGoalTitle}" — CHEW's declared rule treats it as shared, not something to duplicate.`,
        expectedEffectType: 'supports_multiple_goals',
        uncertaintyClassification: matchingRule.certainty,
      });
      items.push(item);
    }
  }

  // The direct form: a fact_key literally shared across two goals' own
  // real chains, no declared rule needed. Exercised for real on every
  // call — currently proven empty for this repo's seed data (no
  // fact_key repeats across the two seeded goals), not skipped.
  const directMatches = await findDirectlySharedFacts(subjectId, goals, factsByKey);
  for (const { fact, satisfyingGoals } of directMatches) {
    const goalIds = satisfyingGoals.map((g) => g.id);
    // eslint-disable-next-line no-await-in-loop -- persistence must happen per-item, matching the declared-rule loop above.
    const item = await findOrCreateLeverageItem({
      subjectId,
      sourceType: 'fact',
      sourceRef: fact.id,
      leverageCategory: 'multi_goal_fact',
      title: `"${fact.fact_key}" is a real requirement in more than one active goal`,
      description: `The real fact "${fact.fact_key}" is, by itself, a requirement_key in more than one active goal's real `
        + `requirement chain (${satisfyingGoals.map((g) => `"${g.title}"`).join(', ')}) — no declared rule is needed, the schema `
        + `itself says both goals read this same fact.`,
      relatedGoalIds: goalIds,
      relatedConstraintIds: [],
      relatedOpportunityIds: [],
      relatedCapabilityIds: [],
      applicabilityRule: `"${fact.fact_key}" appears as a requirement_key in transition_requirements for goals `
        + `${goalIds.join(', ')}, and the real current_state_facts row (id ${fact.id}) satisfies it in each.`,
      evidence: { factId: fact.id, factKey: fact.fact_key, factValue: fact.fact_value, factType: fact.fact_type, directlySharedAcrossGoalIds: goalIds },
      verificationState: fact.fact_type,
      activationStatus: activationStatusForFactType(fact.fact_type),
      suggestedAction: `Preserve or update this one fact rather than re-establishing it separately for each of these goals.`,
      expectedEffectType: 'reduces_duplicate_effort',
      uncertaintyClassification: 'deterministic',
    });
    items.push(item);
  }

  // Staleness sweep: if a fact-sourced item was found and persisted on
  // a PRIOR call but its evidence no longer holds on THIS call (the
  // fact stopped satisfying its own requirement, or the declared rule
  // was removed), the loop above never revisits it at all — a re-run
  // only ever confirms or updates evidence for requirements that are
  // CURRENTLY met. Without this sweep, a stored item would sit
  // unchanged forever, silently claiming a real relationship that no
  // longer holds. Mirrors the same "flip the flag, never silently
  // recompute" discipline as everywhere else in this file — the
  // orphaned item's description/evidence is never rewritten, only its
  // activation_status.
  await sweepStaleLeverageItems({
    subjectId, sourceType: 'fact', leverageCategory: 'multi_goal_fact',
    currentSourceRefs: new Set(items.filter((i) => i.sourceType === 'fact').map((i) => i.sourceRef)),
  });

  return items;
}

// A capability is "dormant" only if it's relevant to an active goal but
// NOT yet connected via a real requirement→capability link — this
// schema has no way to declare "relevant but unlinked" without an
// editorial or rule-based mapping it doesn't have, so this detector
// deliberately finds nothing today rather than guessing from category
// names or vague topical similarity. The one real capability link this
// repo has (bookkeeping_current -> accounting_tax) is already ACTIVE —
// it's the exact mechanism the existing Opportunity Engine wiring uses
// to surface a related capability in a real recommendation — so calling
// it "dormant" would misrepresent something already connected.
// Dormant Capability's full AND-chain, per direct instruction:
//   capability exists
//   + an explicit capability_relevance_rules row authorizes it (the
//     sole authorization point — no similarity heuristic, no fallback)
//   + the capability is CURRENTLY available (a real live provider —
//     activeProviderCount > 0, the exact same signal the Opportunity
//     Radar / Network Room / Wealth World already use, never softened
//     to "the capability exists in the registry")
//   + the subject has a relevant active need (the goal/requirement/fact
//     the rule points at is real and still open)
//   + the capability is NOT already engaged (already linked via a real
//     transition_requirements.capability_id — if it's already active in
//     the Opportunity Engine's own wiring, it is by definition not
//     underused, and calling it "dormant" would misrepresent something
//     already connected)
// Only source_type='goal' has real, exercised logic — 'requirement' and
// 'fact' branches are left as explicit no-ops (never silently treated
// as matches) until a real rule of that shape is actually authored;
// writing untested logic for zero real cases would be exactly the kind
// of premature richness this feature was built to avoid.
async function discoverDormantCapabilityLeverage(subjectId) {
  const goals = await getActiveGoals(subjectId);
  if (goals.length === 0) return [];

  const rulesResult = await query('SELECT * FROM capability_relevance_rules WHERE active = TRUE');
  if (rulesResult.rows.length === 0) return [];

  const capsResult = await query('SELECT id, slug, name, description FROM capabilities');
  const capById = {};
  capsResult.rows.forEach((c) => { capById[c.id] = c; });

  const capabilityOverview = await getCapabilityOverview();
  const overviewBySlug = {};
  capabilityOverview.forEach((c) => { overviewBySlug[c.slug] = c; });

  // "Not already engaged" — the one real per-subject signal this schema
  // supports. routing_events/routing_consents exist in this schema but
  // are scoped to the separate `applications` admissions pipeline, not
  // to intel_subjects — there is no real join path from an
  // intel_subjects row to a routing/handoff record, so that signal
  // genuinely cannot be checked for the illustrative subject. This is a
  // real schema gap, documented rather than silently assumed complete.
  const engagedCapabilityIds = new Set();
  for (const goal of goals) {
    // eslint-disable-next-line no-await-in-loop -- small, bounded goal list.
    const sequence = await getRequirementSequence(goal.id);
    sequence.forEach((r) => {
      if (!r.capabilitySlug) return;
      const cap = capsResult.rows.find((c) => c.slug === r.capabilitySlug);
      if (cap) engagedCapabilityIds.add(cap.id);
    });
  }

  const items = [];
  for (const rule of rulesResult.rows) {
    if (rule.source_type !== 'goal') continue; // not yet implemented — see comment above

    const relevantGoal = goals.find((g) => g.id === rule.source_ref);
    if (!relevantGoal) continue; // rule points at a goal this subject doesn't have active — no match

    const capability = capById[rule.capability_id];
    if (!capability) continue; // defensive only — capability_id is a real FK, this should never fire

    const overviewEntry = overviewBySlug[capability.slug];
    const isAvailable = !!(overviewEntry && overviewEntry.available);
    if (!isAvailable) continue; // honest: no real live provider today, so no fabricated dormant item

    if (engagedCapabilityIds.has(capability.id)) continue; // already engaged — not dormant, already active

    const evidence = {
      capabilityId: capability.id,
      capabilitySlug: capability.slug,
      relevanceRuleId: rule.id,
      goalId: relevantGoal.id,
      activeProviderCount: overviewEntry.activeProviderCount,
    };

    // eslint-disable-next-line no-await-in-loop -- persistence must happen per-item to enforce the unique-evidence constraint per row.
    const item = await findOrCreateLeverageItem({
      subjectId,
      sourceType: 'capability',
      sourceRef: capability.id,
      leverageCategory: 'dormant_capability',
      title: `"${capability.name}" is available and relevant, but not yet part of your path`,
      description: `A real capability ("${capability.name}") in CHEW's network has an explicit, human-authored relevance `
        + `rule to "${relevantGoal.title}" (capability_relevance_rules #${rule.id}), has ${overviewEntry.activeProviderCount} `
        + `real active provider(s) available right now, and is not currently linked to any of this subject's own `
        + `requirements. ${rule.mechanism}`,
      relatedGoalIds: [relevantGoal.id],
      relatedConstraintIds: [],
      relatedOpportunityIds: [],
      relatedCapabilityIds: [capability.id],
      applicabilityRule: `capability_relevance_rules #${rule.id} declares "${capability.slug}" relevant to goal `
        + `${relevantGoal.id} (${rule.relationship_type}); getCapabilityOverview() reports `
        + `${overviewEntry.activeProviderCount} real active provider(s); no transition_requirements row for this `
        + `subject's goals links this capability, so it is not already engaged.`,
      evidence,
      verificationState: 'computed', // availability is a real live COUNT query, not self-reported — same fact_type-vocabulary reuse as elsewhere in this file
      activationStatus: 'available',
      suggestedAction: `Consider connecting "${capability.name}" to this path — it's already real and available, `
        + `just not currently in use.`,
      expectedEffectType: 'unlocks_capability',
      uncertaintyClassification: rule.certainty,
    });
    items.push(item);
  }

  // Staleness sweep, sharing sweepStaleLeverageItems() with
  // discoverMultiGoalFactLeverage() above: a previously-found dormant
  // item whose capability lost its provider, became engaged, or whose
  // rule was deactivated is never silently left looking current.
  await sweepStaleLeverageItems({
    subjectId, sourceType: 'capability', leverageCategory: 'dormant_capability',
    currentSourceRefs: new Set(items.map((i) => i.sourceRef)),
  });

  return items;
}

async function discoverBySourceType(sourceType, subjectId) {
  if (sourceType === 'fact') return discoverMultiGoalFactLeverage(subjectId);
  if (sourceType === 'capability') return discoverDormantCapabilityLeverage(subjectId);
  throw new Error(`Source type "${sourceType}" is not yet supported by any real detector.`);
}

// The single entry point: runs every implemented detector and returns
// every item discovered or re-verified. Never calls an LLM, never
// brainstorms — every returned item traces to real stored evidence.
async function findHiddenLeverage({ subjectId }) {
  const results = [];
  for (const sourceType of IMPLEMENTED_SOURCE_TYPES) {
    // eslint-disable-next-line no-await-in-loop -- small, fixed list of detectors; sequential keeps evidence reads consistent within one call.
    const items = await discoverBySourceType(sourceType, subjectId);
    results.push(...items);
  }
  return results;
}

async function getLeverageItem(id) {
  const result = await query('SELECT * FROM leverage_items WHERE id = $1', [id]);
  if (!result.rows[0]) throw new Error('Leverage item not found.');
  return rowToLeverageItem(result.rows[0]);
}

// The "active discoveries" view — suppresses items a subject has
// already activated, or that have gone stale, from the list of things
// CHEW would surface as a fresh find. getLeverageItem() above still
// returns any item directly by id regardless of status; this is only
// the filtered listing.
async function listActiveLeverage(subjectId) {
  const result = await query(
    `SELECT * FROM leverage_items WHERE subject_ref = $1 AND activation_status NOT IN ('already_activated', 'stale', 'unavailable') ORDER BY created_at DESC`,
    [subjectId]
  );
  return result.rows.map(rowToLeverageItem);
}

async function listAllLeverage(subjectId) {
  const result = await query('SELECT * FROM leverage_items WHERE subject_ref = $1 ORDER BY created_at DESC', [subjectId]);
  return result.rows.map(rowToLeverageItem);
}

async function markLeverageItemActivated(id) {
  const result = await query(
    `UPDATE leverage_items SET activation_status = 'already_activated', updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!result.rows[0]) throw new Error('Leverage item not found.');
  return rowToLeverageItem(result.rows[0]);
}

module.exports = {
  SOURCE_TYPES, IMPLEMENTED_SOURCE_TYPES, LEVERAGE_CATEGORIES, VERIFICATION_STATES,
  ACTIVATION_STATUSES, EXPECTED_EFFECT_TYPES, UNCERTAINTY_CLASSES, LEVERAGE_MODEL_VERSION,
  findHiddenLeverage, discoverBySourceType, discoverMultiGoalFactLeverage, discoverDormantCapabilityLeverage,
  findDirectlySharedFacts, getLeverageItem, listActiveLeverage, listAllLeverage, markLeverageItemActivated,
};
