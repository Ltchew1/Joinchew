# CHEW Intelligence Architecture Review

**Scope:** the intelligence stack described in `ARCHITECTURE.md` and extended
across this session — State, Goals, Requirements, Constraints, Opportunities,
Capability Network, Unlock logic, Scenario Modeling, Cross-Goal Conflict,
Parallel Futures, Hidden Leverage, Historical State, Economic Weather,
Friction Detection. This document does not cover the separate CHEW LLC
consulting/booking system (`CHEW_MASTER_CONTEXT.md`, `bookings`, Stripe
checkout) — a genuinely different product living in the same repository,
with its own schema and its own lifecycle.

**Method:** every claim below was checked directly against the current code
and schema in this repository — `grep`/`read` on every `lib/*.js` and
`api/*.js` file relevant to the intelligence stack, the full
`db/schema.sql`, and a live invariant test run against the local scratch
database (see §20 and the appendix). Nothing here is inferred from file
names or prior session summaries alone. Where a claim is empirical (a query,
a test run), that evidence is cited inline.

---

## 0. Grounding check — before anything else

The directive's own list of "current built foundations" names three items
that **do not exist as real code in this repository**: Cross-System Portal
Reactions, Session Choreography, and Cross-System Focus Mode.

Verified directly: `grep -rl "portal_event\|reaction\|focus_mode\|choreography\|canonical_event\|session_choreography\|portal_state\|global_portal"` across every `.js` and `.sql` file in the repo returns **zero matches**. There
is no event table, no reaction contract, no focus bus, no session
choreography module anywhere in this codebase. `ARCHITECTURE.md` and
`CHEW_MASTER_CONTEXT.md` both independently confirm this from the other
direction: "Client Portal — Status: NOT BUILT (Phase 3)," and "there is no
authenticated portal in this repository" (`FEATURE_FLAGS.md`, repeated
verbatim across several of this session's own feature sections).

This isn't a criticism of the directive — it's the first, most important
finding this review has to report, and applying the same discipline this
whole project has held everywhere else ("never fabricate capability") to the
review itself. §7 and §16 below describe what *does* exist in this area
(nothing formal yet) rather than analyzing a system that isn't there.

Fourteen of the seventeen named foundations are real and were reviewed in
full: State, Goals, Requirements, Constraints, Opportunities, Capability
Network, Unlock logic, Scenario Modeling, Cross-Goal Conflict, Parallel
Futures, Hidden Leverage, Historical State, Economic Weather, Friction
Detection.

---

## 1. The real system map

```
current_state_facts (fact_key, fact_value, fact_type)
        |
        v  [lib/intelligenceEngine.js: evaluateRequirement()]
transition_requirements (comparison, required_value, sequence_order, capability_id)
        |
        v  [first unmet by sequence_order — computeRecommendation() inline
        |   loop, OR scenario-engine.js's deriveState() — see §3]
requirementState (per-key met/unmet) --> readiness (resolvedCount/total)
        |                                        |
        v                                        v
   chosenRequirementKey                    (consumed by every
   ("current focus")                        downstream engine)
        |
        +--> [chosenRequirement.capability_id set?]
        |         v [lib/capabilityGraph.js: getRoutingRecommendation()]
        |     capability_provider_links + network_providers (status=active, is_ready)
        |         v
        |     relatedCapability { available, providers[] }
        |
        +--> constraints (subject_id/goal_id/blocks_transition_id, is_resolved)
        |
        v
  recommendations row (PERSISTED, every call, no dedup — see §3, §19)
        |
        v
  actions row (PERSISTED, reused if a pending one exists for the same
        requirement — the one place with real app-level dedup)

Separately, lib/scenarioModel.js's buildBaselineSnapshot({subjectId, goalId})
re-derives the identical requirementState/readiness/chosenFocus/constraintState
via a SECOND, independent call path (getRequirementSequence() + its own
resolvedMapFromFacts() + scenario-engine.js's deriveState() +
deriveCapabilityCoverage()) — read-only, nothing persisted by this call
itself. This is the shape every downstream historical/analytical engine
actually consumes:

  buildBaselineSnapshot()
        |
        +--> createScenario() / createCrossGoalScenario() / compareCrossGoalFutures()
        |       --> scenarios table (hypothetical, explicitly never a real observation)
        |
        +--> lib/weatherModel.js: computeCurrentStateFields()
        |       --> state_snapshots table (real observed state, deduped by fingerprint)
        |       --> buildEconomicWeather(current, priors) --> 5 signals, current/change/trend
        |
        +--> lib/frictionModel.js: getFrictionForGoal()
                --> reads state_snapshots ONLY (never scenarios)
                --> 4 pattern types, nothing persisted

lib/leverageModel.js discovers leverage_items from THREE independent real
sources: multi-goal fact reuse (cross-references two goals' requirement
chains for the same subject), dormant capability (capability_relevance_rules
+ live provider availability + "not already engaged" via
transition_requirements.capability_id), each with its own staleness sweep.

The public surface (index.html's demo section, chew-lab.html, future-room.html,
unlock-room.html, simulation-room.html, wealth-world.html, network-room.html)
consumes exactly ONE public endpoint for all of this: api/intelligence-demo.js,
which calls computeRecommendation() (writing) + getRequirementSequence() +
getCapabilityOverview() + a goal-title lookup, and returns one JSON payload.
Every internal engine built after Scenario Modeling (leverage, weather,
friction) is reachable only through its own internal-only, feature-flagged
endpoint (api/scenario-model.js, api/leverage-model.js, api/weather-model.js,
api/friction-model.js) — none of these are wired to any public page. The
public rooms disclose that these engines exist, in their own transparency
copy, but render only the fixed demo payload above.
```

### Per-node inventory

| Node | Source table(s) | Owning module | Derived/persisted | Identity-scoped | Illustrative-only |
|---|---|---|---|---|---|
| Current-state fact | `current_state_facts` | `intelligenceEngine.js` (`completeAction`, the only writer) | Persisted | `subject_id` FK | Yes (seed subject 1) |
| Requirement definition | `transition_requirements` | authored via seed SQL, read by `intelligenceEngine.getRequirementSequence()` | Persisted (authored) | none (global taxonomy) | No — real rule authoring, illustrative *values* |
| Requirement state (met/unmet) | none — derived | `evaluateRequirement()` (`intelligenceEngine.js`) | Derived, always fresh | via subject's facts | n/a |
| Readiness / current focus | none — derived | **two independent implementations** — see §3 | Derived, always fresh | via subject | n/a |
| Constraint | `constraints` | authored/seed only; no engine writes it | Persisted | `subject_id`/`goal_id` | Yes |
| Capability availability | `capabilities`, `network_providers`, `capability_provider_links` | `capabilityGraph.js` | Derived (live COUNT, never cached) | none (registry is global) | Registry real, providers currently zero |
| Recommendation | `recommendations` | `intelligenceEngine.js` (sole writer) | Persisted, **unconditional every call** | `subject_id`/`goal_id` | Yes |
| Action | `actions` | `intelligenceEngine.js` (sole writer) | Persisted, app-level dedup (reuses pending row) | `subject_id`/`goal_id` | Yes |
| Scenario | `scenarios` | `scenarioModel.js` (sole writer) | Persisted, has `MODEL_VERSION`+`RULE_VERSION`, lazy staleness | `subject_type`+`subject_ref` (identity-ready) | Yes, DB-blocked from `member` |
| Goal conflict rule | `goal_conflict_rules` | authored only; read by `scenarioModel.js` | Persisted (authored) | none | Real rule, no live consumer breadth yet |
| Leverage item | `leverage_items` | `leverageModel.js` (sole writer) | Persisted, has `LEVERAGE_MODEL_VERSION`, own staleness sweep | `subject_type`+`subject_ref` | Yes, DB-blocked from `member` |
| Capability relevance rule | `capability_relevance_rules` | authored only; read by `leverageModel.js` | Persisted (authored) | none | Real rule, exactly one seeded |
| State snapshot | `state_snapshots` | `weatherModel.js` (sole writer) | Persisted, fingerprint-deduped, has `WEATHER_MODEL_VERSION` | `subject_type`+`subject_ref` | Yes, DB-blocked from `member` |
| Economic Weather signal | none — derived | `weatherModel.js` (`buildEconomicWeather`) | Derived from `state_snapshots` only | via subject | n/a |
| Friction result | none — derived, never persisted | `frictionModel.js` | Derived from `state_snapshots` only | via subject | n/a |
| Feature flag | `feature_flags` | `featureFlags.js` | Persisted (authored), `updated_at`/`created_at` only — no rule version | none | n/a |
| Portal event / reaction / focus mode | **none** | **none** | **does not exist** | n/a | n/a |

---

## 2. Canonical sources of truth

| Concept | Canonical owner | Notes |
|---|---|---|
| Requirement chain for a goal | `intelligenceEngine.getRequirementSequence(goalId)` | One query, imported by `scenarioModel.js`, `leverageModel.js` (transitively), `frictionModel.js` (transitively). Genuinely single-sourced. |
| "Is this requirement met" | `intelligenceEngine.evaluateRequirement(comparison, value, required)` | Imported directly by `scenarioModel.js`'s `resolvedMapFromFacts()`. Genuinely single-sourced — the actual gte/lte/eq/boolean_true rule exists in exactly one function. |
| Current focus / readiness *selection* (given already-evaluated met/unmet flags) | **Not single-sourced** — see §3 | The one real duplication finding in this review. |
| Capability availability | `capabilityGraph.getRoutingRecommendation()` / `getCapabilityOverview()` | Same file, two query shapes (per-capability vs. aggregate) for two different real consumers — not a cross-module risk. |
| Friction | `frictionModel.getFrictionForGoal()`, reading only `state_snapshots` | Single-sourced, verified never touches `scenarios`. |
| Weather | `weatherModel.getEconomicWeather()`, reading only `state_snapshots` | Single-sourced. |
| Scenario effects | `scenarioModel.js`'s `evaluateMove()`/`computeEffects()` | Single-sourced; `createScenario`, `createCrossGoalScenario`, and `compareCrossGoalFutures` all funnel through the same `persistScenario()` and `evaluateFactOverrideForGoal()` helpers (this session's own earlier refactor). |
| Portal events | **No canonical layer exists.** | See §0, §7. |
| Certainty / uncertainty classification | **Not single-sourced** — see §3, §11 | Six independent hand-typed copies of the same vocabulary. |
| Staleness | **Not single-sourced** — see §15 | Three independent implementations. |

---

## 3. Duplicated semantics — the concrete findings

### 3a. Current focus / readiness selection — two real implementations, empirically consistent today

`intelligenceEngine.js`'s `computeRecommendation()` selects the chosen
requirement with its own inline loop:

```js
if (!chosenRequirement && !evaluateRequirement(req.comparison, factValue, req.required_value)) {
  chosenRequirement = req;
}
```

`scenario-engine.js`'s `deriveState()` — the shared pure function loaded by
`simulation-room.html` and `unlock-room.html`, and reused server-side by
`scenarioModel.buildBaselineSnapshot()` (and therefore by `weatherModel.js`
and `frictionModel.js`) — implements the identical rule independently:

```js
if (!met && chosenKey === null) chosenKey = tile.key;
```

`scenario-engine.js`'s own header comment already names this as a
*deliberate, documented* choice ("recomputing it client-side... matches
what the server would compute"), not an accident. That's the right instinct
— but two more copies exist that are **not** documented this way:
`future-room.html` and `chew-lab.html` each have their own third and fourth
independent inline `<script>` reimplementation of "scan for `resolvedCount`
and the first unmet key," reading the *already-server-computed* per-requirement
`met` flags from the demo API payload (they do **not** re-run
`evaluateRequirement` themselves — that part stays single-sourced).

**Verified empirically, not just read in the code**: a scratch invariant
test (`world-state-invariant-test.js`, run against live Postgres) computed
`chosenRequirementKey` and the readiness fraction via all three JS-level
implementations (`computeRecommendation()`, `buildBaselineSnapshot()`,
`scenario-engine.js`'s `deriveState()`) for both real seeded goals. All
three agreed in every case:

```
goal 1: chosenKeyA=credit_score  chosenKeyB=credit_score  chosenKeyC=credit_score   (1/3 all three)
goal 2: chosenKeyA=bookkeeping_current  chosenKeyB=bookkeeping_current  chosenKeyC=bookkeeping_current  (0/2 all three)
```

**Risk classification**: low likelihood (the algorithm is trivial — first
`false` in an ordered array — and the underlying `met` flags are always
single-sourced), medium consequence if it ever did drift (a visible
inconsistency between, say, the Future Room and the Simulation Room). Not
urgent to fix in isolation. It becomes the strongest evidence *for* §20's
recommendation, not a standalone bug to patch.

### 3b. Certainty / uncertainty classification — six independent hand-typed copies

The same five-value vocabulary (`known`, `deterministic`,
`assumption_dependent`, `estimated`/`editorial`, `unknown`) is hand-typed in
**four separate SQL `CHECK` constraints** (`db/schema.sql` lines 677, 718,
796, 846 — `scenarios.uncertainty_classification`,
`goal_conflict_rules.certainty`, `leverage_items.uncertainty_classification`,
`capability_relevance_rules.certainty`) and **two separate JS array
literals** (`scenarioModel.js`'s own `UNCERTAINTY_CLASSES`, `leverageModel.js`'s
own `UNCERTAINTY_CLASSES` — which does *not* import the other file's
constant even though it already imports `listConflictRulesForGoal` from
that same file). `frictionModel.js` sidesteps the whole vocabulary with a
single hardcoded string, `const CERTAINTY = 'deterministic'`, never
imported from either array. **Six independent sources of the same fact.**
This is a real drift risk: adding a sixth value, or renaming `estimated`,
requires remembering to touch six places by hand, with nothing that would
fail loudly if one were missed.

### 3c. Staleness — three independent inventions, one intra-file duplicate

`scenarioModel.js` has its own `checkStaleness(row)` — re-derives current
state, compares, lazily flips `scenario_status` to `'stale'` on read.
`leverageModel.js` has **two separate near-identical inline sweep blocks**
— one inside `discoverMultiGoalFactLeverage()`, one inside
`discoverDormantCapabilityLeverage()`, the second one's own comment
literally reading "mirroring `discoverMultiGoalFactLeverage`'s own."
`weatherModel.js` has no staleness concept (its fingerprint dedup is a
different question — "is this a duplicate?" not "is this now wrong?").
`frictionModel.js` has no staleness concept because it never persists.
**No shared staleness contract exists anywhere.** See §15 for the fuller
audit.

### 3d. What is *not* duplicated — worth stating plainly

Every persisted table in this stack has **exactly one writer module**,
verified by direct grep, not assumption:

| Table | Writer(s) |
|---|---|
| `current_state_facts` | `intelligenceEngine.js` only (`completeAction`) |
| `recommendations` | `intelligenceEngine.js` only |
| `actions` | `intelligenceEngine.js` only |
| `scenarios` | `scenarioModel.js` only |
| `leverage_items` | `leverageModel.js` only |
| `state_snapshots` | `weatherModel.js` only |

This is genuinely strong hygiene and should not be lost in a future
refactor — the risk in this codebase is duplicated *derivation* logic
reading the same real data, not duplicated *write* paths.

---

## 4. The CHEW World Model — does the review prove it's needed?

**Yes.** §3a is the direct evidence: at least four independent places
reconstruct "given a requirement chain and a fact set, what's met, what's
the readiness fraction, and what's the current focus" — one of them
(`buildBaselineSnapshot()`) already does the *fuller* job (also assembling
constraint state and capability coverage) and is already the shared input
every historical/analytical engine (Weather, Friction, indirectly Leverage)
consumes. It is not yet the input `computeRecommendation()` itself consumes
— that function still has its own parallel, narrower derivation, which is
exactly why two independent implementations exist instead of one.

This review does **not** propose building a new, generic, speculative
`CHEW State` object from scratch — 80% of one already exists
(`buildBaselineSnapshot()`), already reused by three of the newest four
engines. The gap is narrower and more concrete than "build a world model":
make the one function that doesn't yet consume it (`computeRecommendation()`)
consume it too, and give the client-side pages one canonical shape to read
instead of each re-deriving `resolvedCount`/`chosenKey` themselves. See §20.

---

## 5. Derivation order

The actual, observed order (not aspirational) is a clean, one-directional
pipeline for every engine in this stack:

```
1. Read real facts (current_state_facts)
2. Read the real requirement chain (transition_requirements, ordered)
3. Evaluate each requirement (evaluateRequirement) -> met/unmet
4. Derive readiness + current focus (first unmet by order)
5. Read real constraints (unresolved, for this subject/goal)
6. If the current-focus requirement names a capability: read live
   provider availability (capabilityGraph)
7. [computeRecommendation only] persist recommendations + actions
8. [scenario/leverage/weather engines only] read the above as an
   already-computed baseline; apply their own rule (fact override,
   relevance rule, snapshot capture) on top; persist their own table
9. [friction only] read persisted state_snapshots history; derive
   patterns; persist nothing
```

There is **no step 12/13** ("emit canonical events," "build portal
reactions") — those steps do not exist yet (§0).

---

## 6. Circular dependency analysis

**None found.** This is a genuine strength worth stating directly, not an
absence-of-evidence non-finding. Traced explicitly:

- `computeRecommendation()` → `capabilityGraph` (one direction only;
  capability lookups never read `recommendations`).
- `scenarioModel` → `intelligenceEngine` + `capabilityGraph` (one
  direction; neither of those ever imports `scenarioModel`).
- `leverageModel` → `intelligenceEngine` + `scenarioModel` +
  `capabilityGraph` (one direction).
- `weatherModel` → `scenarioModel` + `capabilityGraph` (one direction;
  `scenarioModel` never imports `weatherModel`).
- `frictionModel` → `weatherModel` + `intelligenceEngine` (one direction).

Every arrow points the same way: raw state → derived state → historical/
analytical engines. No engine's output feeds back into an earlier stage's
input. Concretely, the exact cycles the directive asked to check for do
**not** exist in this code: recommendation does not depend on Opportunity
Radar's own state (it *produces* `relatedCapability`, never reads a
previously-computed one back); leverage does not write to `goals` or
`current_state_facts`, so it cannot feed back into goal state; friction
reads history but never writes a fact or a recommendation, so it cannot
influence the next recommendation except through a human acting on what
friction told them (a legitimate, intentional, out-of-band loop — a person
reading "this stayed unresolved" and then going and resolving it is the
loop working as designed, not a code-level cycle).

---

## 7. Event architecture

**There is no canonical event system.** (See §0.) What exists instead:

- **Persisted, table-shaped facts of change**: `recommendations` (append-only,
  timestamped, never updated), `actions.status` transitions
  (`pending`→`completed`/`skipped`, with `completed_at`), `scenarios
  .scenario_status` (`current`→`stale`, lazy), `leverage_items
  .activation_status` (7-state lifecycle, some transitions app-triggered
  — `markLeverageItemActivated` — some staleness-sweep-triggered),
  `state_snapshots` (append-only, deduped by fingerprint, never updated).
- **One-shot, presentation-only, non-persisted "moments"**: CHEW Activation,
  CHEW Move collapse, CHEW Blind Spot, CHEW Domino — all client-side
  JS choreography triggered by data already present in one
  `/api/intelligence-demo` response, replaying identically on every page
  load (session-scoped hide-after-first-view for Activation only, via
  `sessionStorage`, not a server-side "seen" record).

Nothing here needs a formal event envelope yet, because nothing consumes
one — there is no reaction system, no reconciliation pass, no push
notification path (`ARCHITECTURE.md` Gap 12, still open). Recommending an
event envelope now (`event_id`, `entity_type`, `previous_state`,
`correlation_id`, etc.) would be exactly the "speculative abstraction ...
because it sounds elegant" the directive warns against — there is no real
consumer to design it against yet, and this project's own repeated
discipline (Life Map, Household, Risk, Document — all explicitly left
"conceptual only, no schema, because no real content exists to justify it")
argues for the same restraint here.

---

## 8. Causality classification

Audited every current cross-system relationship against the directive's own
five-way vocabulary:

| Relationship | Classification | Evidence |
|---|---|---|
| Requirement met/unmet ← facts | **Deterministic** | `evaluateRequirement()`, a pure function of two typed values. |
| Cross-goal conflict ← two goals sharing a fact | **Rule-declared** | `goal_conflict_rules` — refuses to model any pair without an explicit authored row (verified in `conflict-model-test.js`: an undeclared pair is refused, not guessed). |
| Dormant capability ← goal/requirement | **Rule-declared** | `capability_relevance_rules` — same refusal discipline. |
| Multi-goal fact leverage ← shared fact across two goals | **Deterministic** | Computed directly from real shared `requirement_key`s across two real goal chains — no authored rule needed because the relationship *is* the shared key. |
| Friction pattern ← snapshot history | **Deterministic** | Fixed thresholds (2+/3+ comparable observations), no authored rule, no inference. |
| Weather trend ← snapshot history | **Deterministic** | Same. |
| "Requirement X supports goal Y" absent a rule | **Unknown**, correctly refused | Never auto-inferred from label similarity — named explicitly as a deliberate boundary in `ARCHITECTURE.md` §11. |

**No editorial or co-occurring category is in use anywhere in this stack
today.** `leverage_items.uncertainty_classification` reserves `'editorial'`
in its vocabulary but no code path currently produces it (confirmed:
`grep -c "'editorial'" lib/leverageModel.js` finds it only in the constant
declaration, never assigned). No engine upgrades one category into another
— verified structurally: nothing writes `certainty`/`uncertainty_classification`
except at row-creation time, and no `UPDATE` statement anywhere touches
those columns.

This classification is exactly the vocabulary named as scattered in §3b —
the *categories* are used correctly and consistently everywhere they
appear; the *vocabulary itself* is what's duplicated.

---

## 9. Identity-readiness review

Every identity-ready table follows **one consistent pattern**, verified
directly across all three:

```sql
subject_type TEXT NOT NULL CHECK (subject_type IN ('illustrative', 'member')),
subject_ref  INTEGER NOT NULL REFERENCES intel_subjects (id),
...
CHECK (subject_type <> 'member')   -- actively blocks a real row today
```

Present, identically, in `scenarios`, `leverage_items`, and
`state_snapshots`. `capability_relevance_rules` and `goal_conflict_rules`
correctly have **no** `subject_type` at all — they're rule tables, not
subject-scoped data, so the pattern's absence there is correct, not a gap.
`current_state_facts`/`constraints`/`goals`/`actions`/`recommendations`
predate this pattern and use a bare `subject_id` FK with no `subject_type`
column at all — they were never given the identity-ready double-CHECK,
because they were built before it existed (Scenario Modeling was the first
feature to introduce it). This is the one real inconsistency in this
review's identity audit: **five earlier tables and three later tables use
two different identity-boundary conventions**, both currently safe (there
is no `member` row possible either way, since there's no auth to create
one), but not textually uniform.

**What must change when real identity arrives, and where**:
1. The three-table pattern's own migration is already anticipated by its
   own comments ("do not relax the `subject_type` CHECK... until a real
   authenticated member identity layer exists") — the actual change is
   narrow: add real member-creation code, at which point the existing
   `CHECK (subject_type <> 'member')` constraints are the ONE place that
   needs to change (five identical lines to drop, not five different
   designs to reconcile).
2. The five earlier tables need a **decision**, not yet made: do they
   retroactively gain a `subject_type` column (extra migration work now,
   for consistency), or do they stay `subject_id`-only forever because
   `intel_subjects` itself is the identity boundary they already respect
   (no separate `illustrative`/`member` split needed at the fact/goal
   level if the *subject row itself* is what's real-vs-illustrative)?
   This review does not answer that design question — it flags it as the
   one open item any future identity work must resolve *first*, before
   writing migration code, not after.

This is a genuinely low-risk area: one consistent, already-correct pattern
for the newer 60% of the stack, one clear open decision for the older 40%,
zero rows anywhere that could currently be mistaken for a real person.

---

## 10. Historical-data boundaries

Three genuinely distinct kinds of "history" exist, and this review confirms
they do not currently cross:

- **Observed history**: `state_snapshots` only. Written by exactly one
  function (`weatherModel.captureSnapshot()`), which reads
  `buildBaselineSnapshot()` — a real-facts-only read — and **never**
  imports `createScenario`/`createCrossGoalScenario`/`compareCrossGoalFutures`
  or queries the `scenarios` table. Verified directly, twice, by two
  different test suites this session (`weather-model-test.js`,
  `friction-model-test.js`): creating a real hypothetical `Scenario`
  mid-test produced **zero** new `state_snapshots` rows, and the latest
  real snapshot kept reflecting the real (unresolved) fact, not the
  scenario's hypothetical resolved one.
- **Modeled history**: `scenarios` only — baselines + proposed moves +
  computed effects, explicitly labeled hypothetical, `scenario_status`
  (`current`/`stale`), never described as something that happened.
- **Event history**: does not exist yet (§0, §7).
- **Presentation history**: only `sessionStorage`'s "activation already
  seen" flag — client-side only, not server-persisted, not shared across
  devices or sessions, and not really a "history" table by any definition
  used elsewhere in this stack.

No contamination path exists between observed and modeled history, and
that boundary is now tested, not just documented.

---

## 11. Rule system review

Three real, human-authored rule tables exist: `goal_conflict_rules`,
`capability_relevance_rules`, and (arguably) `transition_requirements`
itself (an author-written comparison rule per requirement).

**Fragmentation, evidenced precisely**: `goal_conflict_rules` and
`capability_relevance_rules` share real structural overlap —
both have `certainty` (same vocabulary, §3b), both have `active`,
both are polymorphic-by-source in spirit (`goal_conflict_rules` keys off
two goal ids + a fact key; `capability_relevance_rules` keys off a
polymorphic `source_type`/`source_ref`). Neither has `rule_id` as a stable,
citable identifier separate from its row `id`, neither has an
`effective_date`, and only `capability_relevance_rules` has
`authored_by`/provenance text — `goal_conflict_rules` does not.

**Recommendation, scoped correctly**: do **not** collapse these into one
generic `rules` table — they genuinely encode different relationships
(goal-to-goal vs. capability-to-goal/requirement/fact) and forcing one
schema onto both would blur what each one is actually asserting, which is
exactly the failure mode the directive's own §11 warns against ("do not
collapse fundamentally different rule types into one generic table unless
that genuinely improves the architecture" — here it would not). What
*would* help, cheaply, without a schema change: a shared JS constant for
the certainty vocabulary (§3b fix) and consistent `authored_by`/
`effective_date` provenance columns added to `goal_conflict_rules` to match
`capability_relevance_rules`'s already-better pattern. Named here as a
candidate for a future small pass, not undertaken in this one (see §20 on
scope discipline).

---

## 12. Explainability audit

Checked every major result type for "what did you use / what rule applied /
what do you know / what do you not know / what changed / why is this
shown":

| Result | Evidence emitted *with* the result (not reconstructed after) |
|---|---|
| Readiness / recommendation | `based_on_facts`, `based_on_constraints`, `missing_information` — stored in the same row, same call. Verified in `ARCHITECTURE.md`'s own testing section: "a recommendation can be audited later without re-running the engine." |
| Unlock (`action_if_unmet`) | Author-written text, stored on the requirement row itself, copied onto the `actions.description` at creation time specifically so it stays accurate even if the requirement's text changes later. |
| Scenario effect | `assumptions`, `risks`, `dependencies`, `uncertaintyClassification`, `baselineComputedAt` — all part of the persisted row. |
| Conflict | The refusal message itself names the exact missing rule ("No rule-backed conflict is declared between goals 1 and 2 for fact X — add a row to `goal_conflict_rules` first") — an explanation is emitted even in the *refusal* case, not only the success case. |
| Leverage | `evidence` (JSONB, structurally deduped), `verification_state`, `uncertainty_classification` — all on the row. |
| Weather signal | `explanation`, `evidence` (snapshot ids), `trendClassification`, `historySufficiency` — all part of `buildEconomicWeather()`'s return shape, not a separate lookup. |
| Friction result | `explanation` *and* `whatChewDoesNotKnow` on every single result — the only result type in this stack with an explicit "what I don't know" field baked into its own shape, not just its prose. |

**No engine in this stack reconstructs an explanation after the fact.**
Every one emits its evidence as part of the same computation that produces
the result. This is a second genuine strength worth preserving explicitly
in any future refactor (§20) — a canonical world-state builder must not
regress this by returning a bare state object without carrying evidence
forward into whatever consumes it.

---

## 13. Unknown / unavailable / not-applicable audit

This stack does **not** use one consistent representation — but the
inconsistency is more benign than it might look, because it splits along a
real semantic line rather than being random:

- **A concept that structurally cannot apply to this goal** (no
  requirement links to a capability at all): represented as `null`, not
  `0` or `false` — `capabilityCoverage` is `null` (`scenario-engine.js`),
  `activeOpportunityCount`/`linkedCapabilityCount` are `null`
  (`weatherModel.js`'s `computeCurrentStateFields`). Consistent across
  every engine that touches this concept.
- **A concept that structurally cannot exist anywhere in this schema yet**
  (liquidity, income stability, credit trend, etc.): represented as a named
  object in an explicit unavailable-signals array (`UNAVAILABLE_SIGNALS` in
  `weatherModel.js`), each with its own real `reason` string. Never a bare
  `null` — deliberately more explicit than the "structurally doesn't apply"
  case above, because the *reason* differs (schema gap vs. genuine
  inapplicability) and collapsing them would lose that distinction.
- **A missing fact** (no `current_state_facts` row at all): evaluates to
  `met: false` in `evaluateRequirement()` — **indistinguishable from a fact
  that was checked and failed**, at the boolean layer. This is a real,
  already-named limitation (documented in `FEATURE_FLAGS.md`'s Friction
  Detection section, discovered while building `frictionModel.js`'s
  "missing data isn't friction" requirement) — not fixed in this review,
  correctly left open.
- **"Not modeled" vs. "genuinely absent"**: `frictionModel.js`'s
  `requirementMetAt()` returns `null` (not `false`) for a requirement key
  entirely absent from a snapshot's stored `requirementState` — a third,
  distinct kind of unknown from the two above, and the only one of the
  three that is genuinely never confused with `false` anywhere downstream
  (verified directly in `friction-model-test.js`).

**A durable, minimal contract worth adopting** (not built in this pass):
distinguish exactly two cases going forward, by name, in every new engine —
`unavailable` (this schema cannot compute this at all; carries a `reason`)
and `not_applicable` (this schema *could* compute this, but nothing in the
subject's real data makes the question meaningful for this goal; represented
as `null`, never `0`/`false`). The missing-fact-vs.-explicitly-false
ambiguity is a real gap in `evaluateRequirement()` itself and is out of
scope for a naming convention — it needs an actual third state
(`unknown`/`false`/`true` instead of the current boolean), which is core
intelligence-engine surgery, not something to retrofit quietly.

---

## 14. State versioning audit

| Module | Version constant | Stamped onto its own persisted rows? |
|---|---|---|
| `intelligenceEngine.js` | `RULE_VERSION = 'requirement-sequence-v1'` | **No** — `recommendations` has no version column at all. |
| `scenarioModel.js` | `MODEL_VERSION` + reuses `RULE_VERSION` | Yes — both stored per-scenario. |
| `leverageModel.js` | `LEVERAGE_MODEL_VERSION` | Yes. |
| `weatherModel.js` | `WEATHER_MODEL_VERSION` | Yes — stamped as both `source_version` and `rule_version` (identical value; see §20 note). |
| `frictionModel.js` | `FRICTION_MODEL_VERSION` | N/A — nothing persisted. |
| `scenario-engine.js` | **none** | N/A — pure functions, no persisted output of its own. |
| `featureFlags.js` | none | `feature_flags` has `updated_at`/`created_at` only — no rule-version concept, and doesn't need one (a flag's *status* isn't a computation to version). |

**Can CHEW reconstruct "which logic produced this result at that time"?**
For every persisted intelligence result except `recommendations`: **yes** —
each row carries the version of the logic that computed it, independently
of any other row's version. For `recommendations` specifically: **no** —
the single highest-traffic table in this entire stack (every public demo
hit writes one) has no version column, so if `RULE_VERSION` ever changes, a
row written under the old rule and a row written under the new one are
indistinguishable by inspection. **Smallest fix**: add a `rule_version`
column to `recommendations`, stamped from `intelligenceEngine.js`'s own
already-existing `RULE_VERSION` constant — a one-line schema addition and a
one-line insert change, not attempted in this pass per the directive's own
scope discipline, named here as the single most concrete, cheapest
follow-up this review surfaced.

---

## 15. Staleness review

Covered in full in §3c. Summary: **three independent implementations, one
of them internally duplicated.** No shared freshness contract exists.
Concretely warranted, because the *concept* is genuinely the same across
all three ("does this persisted row still reflect the real current state it
was computed from?") even though the *check* differs slightly per table
(Scenario re-derives and compares the full baseline; Leverage checks
whether the specific source fact/requirement/rule that justified the item
still holds). A shared `checkFreshness(sourceType, currentRealState)`
contract — not a shared *table*, since Scenario and Leverage genuinely have
different "what counts as stale" definitions — could hold the common
scaffolding (lazy-check-on-read, flip-and-persist-once, never silently
re-freshen) while each caller supplies its own comparison. Not built in
this pass.

---

## 16. Portal integration map

**There is no portal to integrate with** (§0). What exists today:

```
engine result --> one public JSON endpoint (api/intelligence-demo.js)
                    --> static HTML page's own inline <script>
                         --> DOM update (gauges, chips, chain dots)
```

Every public room talks **directly** to `api/intelligence-demo.js` and
renders its own view of the same payload — there is no shared "reaction"
layer between the API response and the DOM, because nothing downstream of
the API needs one yet (no notification, no cross-page state, no session
memory beyond `sessionStorage`'s one activation flag). This is not a
"bypass" in the sense of skipping a real system — it's the *only* system,
correctly used consistently by all six rooms. It becomes a real
architectural question only once a portal exists to route through instead
— premature to design against today (§7).

---

## 17. Performance / duplication findings

- **The one concrete, currently-live cost**: `computeRecommendation()`
  persists a `recommendations` row **unconditionally, on every call, with
  no request-level dedup** — and it is the function `api/intelligence-demo.js`
  calls on every hit to the public, unauthenticated homepage demo section
  and every room page load. Directly measured this session (not projected):
  a scratch invariant test's own two "read-only-in-intent" calls inserted
  exactly two new rows (`recommendations` count 5→7, zero deduplication at
  any layer). In production this table grows by one row per page view of
  any room, unbounded, forever, for the one shared illustrative subject —
  the single most concrete performance/growth finding in this review. `actions`
  does **not** have this problem — it correctly reuses an existing pending
  row per subject+requirement (verified: 1 pending action survived across
  all 5+ recommendation calls).
- **Repeated state reconstruction**: §3a's four independent
  readiness/chosen-focus derivations are each cheap (one linear scan over a
  2-3-row array in this repo's current seed data) — not a measurable
  performance problem *today*, but the shape of the risk the directive
  asked to look for, and the same underlying redundancy §20 addresses.
- **Repeated DB reads**: `buildBaselineSnapshot()` is called fresh, from
  scratch (4+ queries), by every one of `createScenario`,
  `createCrossGoalScenario`, `weatherModel.getEconomicWeather()`, and
  (transitively) `frictionModel.getFrictionForGoal()` — each call is
  independent, no request-scoped caching. Given this repo's current traffic
  and data size (one illustrative subject, 2-3 requirements per goal), this
  is not worth optimizing yet; flagged only because a canonical world-state
  builder (§20) would naturally absorb this too, as a side benefit, not a
  primary goal.
- **Duplicate serialization**: not found — each engine's JSON shape is
  purpose-built for its own consumer, not reserialized through multiple
  layers.

---

## 18. Test architecture review

Six intelligence test files exist (scratch-only, matching this repo's own
"no committed test suite" convention — `ARCHITECTURE.md`'s own "Testing
performed" section says so directly): `scenario-model-test.js` (37),
`conflict-model-test.js` (29), `parallel-futures-test.js` (20),
`leverage-model-test.js` (31), `dormant-capability-test.js` (21),
`weather-model-test.js` (43), `friction-model-test.js` (38) — **219 total
assertions**, all re-run together this session with zero cross-feature
regressions.

**What they prove**: unit correctness (each engine's own rules), DB
constraints (every identity-boundary `CHECK`, re-verified per feature, not
assumed to still hold), fresh-process behavior (explicitly re-verified
after the Hidden Leverage module-cache bug was found), HTTP behavior (every
feature's endpoint tested against a freshly restarted server, flag-gated
404→200→404), and several genuine cross-engine invariants already:
scenario state never enters `state_snapshots` (tested twice, in two
different suites), undeclared cross-goal relationships are refused (tested
in both `conflict-model-test.js` and `parallel-futures-test.js`),
unavailable signals never silently become a number (tested in
`weather-model-test.js`).

**What was missing before this review, now added**: a direct,
cross-*module* invariant proving §3a's finding — that `computeRecommendation()`,
`buildBaselineSnapshot()`, and `scenario-engine.js`'s `deriveState()` agree
on the same real data. This didn't exist because no single test file
imports all three; each feature's own test suite only exercises its own
engine's re-derivation. Added as `world-state-invariant-test.js` (10
assertions, all passing) — see the appendix for the full run. This is
exactly the "same state → same readiness everywhere" invariant the
directive named as an example, and it's now proven, not assumed.

**Other invariant gaps this review surfaces but does not fill** (correctly
left for whoever implements §20, since testing an invariant before the
refactor that would make it *matter* is premature): "one transition never
generates conflicting events" (no event system exists to test — §7);
"same canonical event maps consistently across surfaces" (same reason).

---

## 19. Top 10 failure modes, ranked by likelihood × consequence

1. **Public write-path growth on `recommendations`** (§17, §19) —
   HIGH likelihood (already happening, measured), MEDIUM consequence
   (unbounded table growth, no user-facing symptom yet, but a real
   operational cost as traffic grows and a real blocker for eventually
   reasoning about "how many times has CHEW recommended this" if that ever
   becomes a feature). **Highest-ranked because it's the only finding in
   this review that is actively occurring in production today, not a
   hypothetical.**
2. **Missing-fact vs. explicitly-false ambiguity in `evaluateRequirement()`**
   (§13) — MEDIUM likelihood (already the honest reason Friction Detection
   had to name a real limitation), MEDIUM-HIGH consequence (any future
   engine reasoning about "was this ever actually checked" would silently
   get the wrong answer; already partially mitigated by every downstream
   engine treating `false` conservatively, but the root ambiguity persists).
3. **Certainty vocabulary drift** (§3b, §8) — LOW-MEDIUM likelihood (six
   copies, but all copied correctly so far), MEDIUM consequence if it ever
   drifts (a `CHECK` constraint rejecting a legitimately-intended value, or
   two engines silently meaning different things by the same word).
4. **Recommendations table has no `rule_version`** (§14) — LOW likelihood
   (the rule hasn't changed since it was written), HIGH consequence if it
   ever does (every existing row becomes ambiguous retroactively, with no
   fix possible after the fact — this is the one finding where *not*
   acting now makes a future fix strictly more expensive, since old rows
   can never regain a version they weren't stamped with).
5. **Old-vs-new identity-boundary convention split** (§9) — LOW likelihood
   of causing a bug today (no auth exists to trigger either path), MEDIUM
   consequence at migration time (an unresolved design question left for
   whoever builds real identity, rather than five clean, uniform tables).
6. **Duplicated current-focus/readiness derivation** (§3a, §4, §20) — LOW
   likelihood (proven consistent today, trivial algorithm), MEDIUM-HIGH
   consequence at scale (this is precisely the finding that motivates
   §20 — four copies is fine, but the codebase is still adding new
   engines that each want this same derived state, and each new consumer
   is a new place the four-way agreement could eventually break).
7. **Staleness reinvented per-module** (§3c, §15) — LOW likelihood of an
   active bug (each implementation is individually correct, tested), LOW-
   MEDIUM consequence (mostly a maintenance/consistency cost, not a
   correctness risk today).
8. **Illustrative subject mistaken for a member** — LOW likelihood (the
   double-`CHECK` pattern actively blocks this at the DB layer on every
   identity-ready table, re-verified this session for each new feature),
   LOW consequence even if attempted (the insert simply fails). Ranked low
   specifically *because* this project has been unusually disciplined about
   it — worth noting as evidence the guardrail is working, not as an open
   risk.
9. **A stale provider treated as available** — Verified NOT currently
   possible: `getCapabilityOverview()`/`getRoutingRecommendation()` compute
   `available` as a live `COUNT(...) > 0` on every call, never cached, and
   there is no capability-freshness field anywhere in this schema for a
   "stale-but-marked-available" state to exist in the first place. Included
   here specifically to record that it was checked and ruled out, not
   assumed safe.
10. **UI recomputing intelligence independently of the server** — Verified
    NOT currently happening for the one value that matters most (`met`
    itself, §3a) — every client-side reimplementation reads the
    server-computed `met` flag rather than re-deriving it from raw facts.
    The *selection* logic (§3a) is recomputed client-side, but from
    server-computed inputs, which is a materially smaller risk than
    recomputing from raw facts would be. Included to record the boundary
    precisely, since "UI recomputing intelligence" could easily be
    overstated as a bigger problem than the evidence supports.

**Architecture changes that reduce multiple risks at once**: items #1, #4,
and #6 are all narrowed or solved by the same single move — see §20.

---

## 20. Ranked next architectural opportunities

1. **Canonical World State** (extend `buildBaselineSnapshot()` into the one
   read path `computeRecommendation()` also uses) — directly addresses
   failure modes #1, #4, and #6 simultaneously; see below for the full
   case.
2. **`recommendations.rule_version` column** — the cheapest single fix in
   this review (§14, failure mode #4); worth doing regardless of whether
   #1 is undertaken, since it's a one-line schema change with no behavioral
   risk.
3. **Shared certainty-vocabulary constant** — small, mechanical, six call
   sites to update, addresses failure mode #3; natural to bundle into
   whatever pass eventually touches #1, since both involve
   `scenarioModel.js` and `leverageModel.js`.
4. **`goal_conflict_rules` provenance columns** (`authored_by`,
   `effective_date`) to match `capability_relevance_rules` (§11) — small,
   additive, not urgent.
5. **Identity-boundary convention decision for the five earlier tables**
   (§9) — not urgent (nothing currently at risk), but should be *decided*
   before real identity work begins, not discovered mid-migration.
6. **Shared staleness contract** (§15) — real but lower-urgency than #1;
   natural follow-on once #1 exists, since a canonical world-state read
   would also be the natural place a shared `checkFreshness()` compares
   against.
7. **Event Spine, Portal Reaction contract, Session Choreography** — **not
   recommended now.** No real consumer exists for any of these yet (§0,
   §7, §16). Building them speculatively is precisely the "add
   abstractions because they sound elegant" failure mode this project has
   consistently avoided elsewhere (Household, Risk, Document, Outcome —
   all correctly left "conceptual only" until a real need exists). Revisit
   only once a real authenticated portal is actually being built — at
   that point the event/reaction question becomes concrete instead of
   speculative.
8. **Identity Foundation** — **not recommended now**, for the same reason
   the repo has consistently given: this pass confirms (§9) the
   identity-ready tables are already correctly structured to receive it
   later, at low migration cost, whenever real auth actually exists. There
   is no evidence in this review that the *architecture* is what's
   currently blocking it — the blocker is that no auth system exists at
   all, which is a build decision, not an architecture gap this review can
   close.

---

# SINGLE HIGHEST-LEVERAGE NEXT MOVE

## Extend the canonical world-state read path

**What it is**: `lib/scenarioModel.js`'s `buildBaselineSnapshot({subjectId,
goalId})` already assembles the one thing every engine in this stack needs
— requirement state, readiness, current focus, constraint state, capability
coverage — from real data, in one function, already reused by three of the
four newest engines (Weather, Friction, and indirectly Leverage). The move
is **not** to invent a new "World State" concept; it's to close the one gap
that keeps it from being *actually* canonical: make `intelligenceEngine.js`'s
`computeRecommendation()` — the one function that still has its own
parallel, independently-coded derivation (§3a) — consume the same read path
instead of re-deriving it, and give the six public HTML rooms one
server-computed field for `resolvedCount`/`chosenKey` instead of each
re-deriving it client-side (§3a, §17).

### Why it wins

It's the only candidate in §20's ranked list that measurably reduces three
separate failure modes at once (#1, #4, #6) rather than one. It requires no
new schema, no new concept, and no identity work — it's a consolidation of
logic that already agrees today (proven in §3a and the appendix), not a
redesign of what the logic *means*. And it's the one gap standing between
"this codebase has excellent single-writer discipline per table" (§3d, a
real, verified strength) and "this codebase has excellent single-*source*
discipline per concept" — right now it has the first without fully having
the second.

### What it solves

- Removes the last independent reimplementation of "current focus" logic
  inside `computeRecommendation()` itself, leaving `scenario-engine.js`'s
  already-documented client-side mirror as the *only* remaining copy
  (down from four to two, one of which is already justified in writing).
- Gives `recommendations` a natural place to also carry `rule_version`
  (§20 item #2) and the fuller evidence shape (`requirementState`,
  `constraintState`, `capabilityCoverage`) that Scenario/Weather/Friction
  already get but `computeRecommendation()`'s callers currently don't.
- Makes future engines (whatever comes after Friction Detection) have
  exactly one obvious place to read current state from, rather than a
  choice between two equally-plausible-looking functions.

### What it replaces or consolidates

- `computeRecommendation()`'s inline chosen-requirement loop and
  `evaluatedFacts` construction — replaced by a call into
  `buildBaselineSnapshot()`'s already-existing, already-tested
  `requirementState`/`readiness`/`currentRecommendation` fields.
- Nothing about the **write path** changes — `computeRecommendation()`
  still owns persisting `recommendations`/`actions`, still the only writer
  of either table. This move is scoped to the *read/derive* half of that
  function only.

### What it deliberately does not solve

- The missing-fact-vs.-false ambiguity in `evaluateRequirement()` (§13,
  failure mode #2) — a different, deeper fix to the comparison rule itself,
  not a consolidation problem.
- The certainty-vocabulary duplication (§3b) — related, bundleable into the
  same pass for efficiency, but not solved *by* this move; it needs its own
  one-line-per-file fix.
- Any event/portal/reaction work (§7, §16, §20 item #7) — explicitly out of
  scope until a real consumer exists.
- Real identity (§9, §20 item #8) — this move doesn't touch the
  `subject_type` boundary at all.

### Migration risk

**Low.** The two independent implementations already agree on real data for
both real goals (proven, §3a and appendix) — this is a consolidation of
logic that's already behaviorally identical, not a change in what "current
focus" *means*. The main risk is a silent behavioral change during the
refactor (e.g., `buildBaselineSnapshot()`'s constraint query has a slightly
different `WHERE` clause shape than `computeRecommendation()`'s — both
filter on `is_resolved = FALSE AND (goal_id = $2 OR blocks_transition_id =
$3)` today, so this specific risk is not present, but any future edit to
either query independently could reintroduce it if they're not unified).
Mitigated by re-running all 219+ existing assertions plus the new 10-assertion
world-state invariant test after the change, before considering it done.

### Implementation size

**Small-to-medium.** Bounded to one file's internal derivation logic
(`intelligenceEngine.js`), one small schema addition
(`recommendations.rule_version`), and a handful of client-side script edits
(reading one new server-provided field instead of re-deriving it) — not a
rewrite of any engine's rules, output shape, or persisted schema beyond the
one new column.

### First bounded slice (not built in this pass — sized for the next one)

1. Add `recommendations.rule_version TEXT` (nullable on existing rows,
   stamped from `intelligenceEngine.RULE_VERSION` on every new insert).
2. Inside `computeRecommendation()`, replace the inline
   `chosenRequirement`/`evaluatedFacts` loop with a call to
   `buildBaselineSnapshot({subjectId, goalId})`, mapping its
   `requirementState`/`readiness`/`currentRecommendation` fields onto the
   exact same public return shape `computeRecommendation()` already
   promises its callers (`api/intelligence-demo.js`,
   `api/intelligence-recommendation.js`) — a pure internal refactor, zero
   API contract change.
3. Re-run all seven existing test suites plus
   `world-state-invariant-test.js`; the invariant test's own assertions
   should now be trivially true by construction rather than true by
   coincidence — worth re-running specifically to confirm that shift, not
   just to check for regressions.
4. Only after that's proven stable: update `future-room.html` and
   `chew-lab.html`'s inline scripts to read a new
   `worldState.readiness`/`worldState.chosenKey` field directly from the
   API response instead of their own `resolvedCount`/`isResolved` client-side
   scans — the smallest possible visible change, and the one that finally
   retires the last two undocumented copies named in §3a.

Nothing beyond this review and its one supporting invariant test was built
in this pass, per the directive's own instruction to stop at the review.

---

## Appendix — the invariant test run

`world-state-invariant-test.js` (scratch-only, not committed — matching
this repo's established convention that no automated test suite lives in
the repository itself), run fresh against live Postgres:

```
--- goal 1 ---
ok: chosenRequirementKey agrees (computeRecommendation vs buildBaselineSnapshot): credit_score / credit_score
ok: chosenRequirementKey agrees (computeRecommendation vs scenario-engine.js deriveState): credit_score / credit_score
ok: readiness fraction agrees (computeRecommendation vs buildBaselineSnapshot): 1/3 / 1/3
ok: readiness fraction agrees (computeRecommendation vs scenario-engine.js deriveState): 1/3 / 1/3

--- goal 2 ---
ok: chosenRequirementKey agrees (computeRecommendation vs buildBaselineSnapshot): bookkeeping_current / bookkeeping_current
ok: chosenRequirementKey agrees (computeRecommendation vs scenario-engine.js deriveState): bookkeeping_current / bookkeeping_current
ok: readiness fraction agrees (computeRecommendation vs buildBaselineSnapshot): 0/2 / 0/2
ok: readiness fraction agrees (computeRecommendation vs scenario-engine.js deriveState): 0/2 / 0/2

recommendations row count: 5 -> 7 (two "read-only-in-intent" calls, zero dedup at any layer)
ok: observed exactly 2 new unconditional recommendations rows from 2 calls

ALL WORLD-STATE INVARIANT CHECKS PASSED (three independent code paths currently agree)
```

10/10 assertions passed. No production database was touched — this ran
only against the local scratch database used throughout this session.
