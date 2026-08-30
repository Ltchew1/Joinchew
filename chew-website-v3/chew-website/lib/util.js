// lib/util.js
//
// Small, genuinely-shared pure helpers with no database/network access.
// Kept separate from any one feature's model file so a second real user
// doesn't have to duplicate it — see lib/leverageModel.js and
// lib/weatherModel.js, both of which need deterministic, key-order-
// independent state comparison for real reasons (evidence dedup and
// state-fingerprint dedup respectively).

// Postgres's jsonb type does not preserve object key insertion order —
// it canonicalizes on write, so a value read back from a jsonb column
// can have keys in a different order than the JS object literal that
// produced it, even when every field value is identical. A plain
// JSON.stringify comparison would treat that as a mismatch. Sorting
// keys recursively before comparing/hashing removes that false signal.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Certainty / uncertainty classification — ARCHITECTURE_REVIEW.md §3b
// found the same five-value vocabulary hand-typed independently in
// lib/scenarioModel.js's UNCERTAINTY_CLASSES, lib/leverageModel.js's own
// separate UNCERTAINTY_CLASSES (which swaps 'estimated' for 'editorial'),
// and lib/frictionModel.js's hardcoded CERTAINTY string — six copies of
// what should be one definition. Every individual value now has exactly
// one canonical spelling here; the two real vocabularies (scenarios/
// goal_conflict_rules/capability_relevance_rules use one 5-value set,
// leverage_items genuinely uses a different 5-value set — see
// leverageModel.js's own comment on why 'editorial' exists) are explicit
// compositions of these same canonical strings, not independent arrays.
const CERTAINTY_VALUES = Object.freeze({
  KNOWN: 'known',
  DETERMINISTIC: 'deterministic',
  ASSUMPTION_DEPENDENT: 'assumption_dependent',
  ESTIMATED: 'estimated',
  EDITORIAL: 'editorial',
  UNKNOWN: 'unknown',
});

// Matches db/schema.sql's scenarios.uncertainty_classification,
// goal_conflict_rules.certainty, capability_relevance_rules.certainty.
const SCENARIO_UNCERTAINTY_CLASSES = [
  CERTAINTY_VALUES.KNOWN, CERTAINTY_VALUES.DETERMINISTIC, CERTAINTY_VALUES.ASSUMPTION_DEPENDENT,
  CERTAINTY_VALUES.ESTIMATED, CERTAINTY_VALUES.UNKNOWN,
];

// Matches db/schema.sql's leverage_items.uncertainty_classification —
// deliberately swaps 'estimated' for 'editorial' (see leverageModel.js).
const LEVERAGE_UNCERTAINTY_CLASSES = [
  CERTAINTY_VALUES.KNOWN, CERTAINTY_VALUES.DETERMINISTIC, CERTAINTY_VALUES.ASSUMPTION_DEPENDENT,
  CERTAINTY_VALUES.EDITORIAL, CERTAINTY_VALUES.UNKNOWN,
];

// Shared "flip to stale, exactly once" primitive — ARCHITECTURE_REVIEW.md
// §3c/§15 found staleness reinvented three times (scenarioModel's
// checkStaleness, leverageModel's two near-identical sweep blocks).
// This factors ONLY the guard-and-flip shape every one of those
// ultimately reduces to; it deliberately does NOT decide what "no
// longer fresh" means for any given table — scenarios compare a
// preserved baseline against real current state, leverage_items compare
// either evidence equality or membership in a freshly-discovered set —
// those genuinely different definitions stay with their own callers on
// purpose, rather than being generalized into one framework that would
// blur them together. The caller supplies its own literal, parameterized
// UPDATE as `markStale` — this never builds SQL dynamically.
async function flipToStaleOnce({ alreadyStale, markStale }) {
  if (alreadyStale) return { flipped: false };
  await markStale();
  return { flipped: true };
}

module.exports = {
  stableStringify, CERTAINTY_VALUES, SCENARIO_UNCERTAINTY_CLASSES, LEVERAGE_UNCERTAINTY_CLASSES,
  flipToStaleOnce,
};
