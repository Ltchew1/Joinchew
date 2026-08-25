# CHEW Intelligence System — Technical Architecture

This document defines the machine-readable model CHEW's intelligence
layer operates on, and the engines that reason over it. It is written
against what actually exists in this repository today (a static site
plus a handful of Vercel serverless functions backed by Postgres — no
auth system, no ML infrastructure, no event pipeline), not against an
assumed platform. Where the ontology below implies something that
doesn't exist yet (a real user-identity system, a document store, a
provider-outcome webhook), that's named explicitly as a gap rather than
assumed solved.

Companion documents: `PATH_ENGINE.md` (business-formation path lookup),
`CAPABILITY_NETWORK.md` (provider/routing registry), `FEATURE_FLAGS.md`
(launch-gating registry). This document sits above all three: the
intelligence engines described here are the reasoning layer that would
eventually *call* the Path Engine and Capability Network as data
sources, not replace them.

---

## 1–3. Ontology, core entities, relationships

The core architectural principle from the directive: CHEW is not
organized around services, it's organized around **transitions** — a
person's movement from one state to a better one. Every other entity
exists to make a transition computable and explainable.

Below, each entity lists: what it represents, key fields, relationships,
what's stored vs. computed, what must never be inferred without
evidence, its privacy classification, and its phase.

**Privacy classes used throughout:**
`PUBLIC` (no sensitivity), `PERSONAL` (identifies a person but not
sensitive alone — name, goal titles), `SENSITIVE` (financial/legal
detail — income, debt, credit facts, documents), `RESTRICTED` (would
require special handling if ever collected — SSN, exact account
numbers; **nothing in the MVP schema stores RESTRICTED data**).

### Subject (MVP — implemented this pass, as `intel_subjects`)
Represents a person CHEW is reasoning about. **Not a real authentication
system** — this repo has no login, no session, no identity verification.
A subject is a bare row (`id`, `label`, `created_at`) that other tables
key off of. Building real auth is out of scope for this pass and is
listed as a gap below, not simulated.
- Relates to: Goal, current-state Fact, Constraint, Recommendation (all
  by `subject_id`).
- Privacy: PERSONAL at minimum; becomes SENSITIVE the moment real facts
  are attached. Every MVP row is synthetic/test data, explicitly labeled.
- Phase: MVP (minimal shell only — see Gap 1).

### Household (conceptual)
Represents a economic unit larger than one subject (a couple, a family
managing finances jointly). Real financial decisions are frequently
household-level, not individual — a mortgage, a shared debt.
- Fields (conceptual): id, members (subject_ids), shared facts.
- Phase: **conceptual only**. No household reasoning exists or is built
  in this pass — a Subject is the only supported unit. Do not add a
  `households` table until a real multi-subject use case exists;
  designing it in the abstract risks guessing wrong about the join
  model (shared facts vs. per-member facts vs. both).

### Goal (MVP — implemented this pass, as `goals`)
What the subject is trying to accomplish.
- Fields: `id`, `subject_id`, `transition_id` (FK, nullable — a goal can
  exist before a formal transition is matched to it), `title`,
  `category`, `priority`, `target_date`, `status`
  (`active`/`completed`/`abandoned`), `created_at`.
- Relates to: Subject (owns it), Transition (what state change it maps
  to), Constraint (what's blocking it), Recommendation (computed output).
- Stored permanently: title, category, target_date, status.
- Computed dynamically: progress, readiness (see Readiness Engine) —
  never stored as a stale snapshot; recomputed from current facts on
  read, or explicitly timestamped if ever cached.
- Never infer without evidence: **priority** and **status** are always
  subject-declared, never inferred from behavior in the MVP — inferring
  "this goal seems abandoned because they stopped answering" is a
  Phase 2+ capability requiring its own evidence model and disclosure
  ("CHEW inferred this — confirm?"), not a default.
- Privacy: PERSONAL (title/category), SENSITIVE if the title itself
  reveals financial detail (a target_date tied to a specific dollar
  amount, for instance) — classify at the field level, not the table
  level.
- Phase: MVP.

### Goal category (MVP, as a `CHECK`-constrained field on `goals.category`, not a separate table)
A fixed taxonomy (`employment`, `business`, `credit`, `housing`,
`education`, `assets`, `other`) kept as an enum rather than a table for
the MVP — there's no evidence yet that this taxonomy needs runtime
extensibility. Promote to a table (matching the `capabilities` taxonomy
pattern already in this repo) the first time a category needs
metadata beyond a label.

### Current state / Fact (MVP — implemented this pass, as `current_state_facts`)
An atomic, typed piece of information about a subject's present
condition — the State Engine's core unit.
- Fields: `id`, `subject_id`, `fact_key` (e.g. `credit_score`,
  `down_payment_savings_cents`, `documented_income`), `fact_value`
  (stored as `TEXT`, cast by the reader per `fact_key`'s known type —
  see Gap 2 on why this isn't a typed-column model yet), `fact_type`,
  `source_note`, `recorded_at`.
- `fact_type` is a hard `CHECK` enum and is the single most important
  field in this table: `user_provided` (subject typed it in — no
  verification), `verified` (checked against a real source, e.g. a
  credit-report pull, a document upload), `computed` (derived from other
  facts by CHEW, e.g. debt-to-income computed from separately-provided
  income and debt facts), `inferred` (CHEW guessed it from a pattern,
  not stated or computed from hard data). **These must never be mixed or
  silently upgraded** — a `user_provided` fact does not become
  `verified` just because CHEW used it in three recommendations. The
  directive is explicit about this and it's enforced by keeping
  `fact_type` a required, non-defaultable column with no "unknown"
  option — every fact must be honestly classified at insert time.
- Never infer without evidence: `verified` facts require a `source_note`
  identifying what verified them (`CHECK` constraint in the MVP schema
  — see below). There is no automated verification pipeline in this
  repo (no credit bureau integration, no bank-linking); every `verified`
  fact in this pass's test data is manually so-labeled to demonstrate
  the schema, not backed by a real integration — flagged in the seed
  file, same pattern as `PATH_ENGINE.md`'s `manually_verified` status.
- Privacy: SENSITIVE by default (income, credit, debt facts) — every
  fact row should be treated as SENSITIVE regardless of `fact_key`
  unless a specific key is allowlisted otherwise; this pass does not
  build field-level encryption (Gap 3).
- Phase: MVP.

### Transition (MVP — implemented this pass, as `transitions`)
A defined state-change CHEW understands how to reason about — the
"from state → to state" the directive names as the core unit of the
platform.
- Fields: `id`, `slug`, `name`, `from_state_label`, `to_state_label`,
  `description`, `category`.
- Relates to: TransitionRequirement (1:many — what must be true to
  complete it), Goal (many goals can target one transition).
- Stored permanently: the definition itself (this is a taxonomy/rules
  table, like `business_types` in the Path Engine — an author defines
  it, it doesn't come from user data).
- Phase: MVP (as a defined-by-CHEW rules table — see Gap 4 on why
  transitions aren't user-authorable yet).

### TransitionRequirement (MVP — implemented this pass, as `transition_requirements`)
One condition that must hold for a transition to be considered
achieved — what makes the Unlock Engine and Readiness Engine
explainable rather than a black box.
- Fields: `id`, `transition_id`, `requirement_key` (matches a
  `fact_key`), `label`, `comparison` (`gte`/`lte`/`eq`/`boolean_true`),
  `required_value`, `unit`, `sequence_order`, `action_if_unmet` (the
  literal next-step text CHEW surfaces when this requirement isn't met
  — no NLG, no generated copy, an author writes it).
- This is a deliberately simple comparison model (numeric
  gte/lte/eq, or boolean) — it cannot express "either A or B", "A only
  matters if B is also true", or genuine multi-factor scoring. That's
  intentional for the MVP: a requirement engine that can only do what it
  can explain in one sentence is safer than one that's more powerful but
  opaque. Compound logic is Phase 2 (see MVP boundary).
- `sequence_order` is the **entire leverage model in the MVP**. The
  directive asks for constraints/requirements to be ranked by leverage
  ("resolving one removes three others") — that requires a dependency
  graph across requirements, which requires knowing real relationships
  between real requirements, which doesn't exist yet for any transition
  in this repo. Rather than fake a leverage score, the MVP ranks
  strictly by `sequence_order`, an author's stated priority. This is
  named honestly in the engine's output (see Gap 5), not disguised as
  computed leverage.
- Phase: MVP.

### Constraint (MVP — implemented this pass, as `constraints`)
Something currently blocking progress.
- Fields: `id`, `subject_id`, `goal_id` (nullable), `constraint_type`
  (the directive's own list, as a `CHECK` enum: `financial`,
  `documentation`, `eligibility`, `timing`, `knowledge`,
  `legal_regulatory`, `credit`, `income`, `capacity`, `geographic`,
  `dependency`, `missing_prerequisite`), `description`, `is_resolved`,
  `blocks_transition_id` (nullable FK to `transitions`), `created_at`,
  `resolved_at`.
- Never infer without evidence: a constraint is only ever
  subject-declared or engine-derived from an unmet `TransitionRequirement`
  in this pass — there's no pattern-detection that invents a constraint
  the subject never stated and no requirement ever flagged. Inferred
  constraints ("you seem to have a cash-flow problem") are Phase 2+ and
  need their own evidence/confidence model before they can exist safely.
- Privacy: SENSITIVE (constraint descriptions frequently contain
  financial/legal detail).
- Phase: MVP.

### Risk (conceptual)
A negative event that could occur, distinct from a Constraint (which
blocks progress now). E.g., "if you leave your job before closing,
financing falls through."
- Phase: **conceptual only**. Not built. The Constraint Engine's MVP
  only reasons about present blockers, not forward-looking risk — risk
  modeling needs a probability/impact representation that doesn't exist
  and shouldn't be invented without real cases to design against.

### Opportunity (architectural — schema exists via `capabilities`/`network_providers`, no new table this pass)
Something available to the subject now or later — this is intentionally
**not a new entity**. The directive's own Opportunity fields (eligibility
requirements, geography, deadline, provider, cost, documents,
availability, confidence/freshness) already map closely onto the
existing `capabilities` + `network_providers` + `capability_provider_links`
tables from `CAPABILITY_NETWORK.md`. Building a parallel `opportunities`
table would fork the source of truth the directive explicitly warns
against ("connect directly to the capability registry"). See §11.

### Eligibility requirement (MVP — modeled as `TransitionRequirement`, not a separate entity)
The directive lists this separately from Opportunity, but structurally
it's the same shape as a `TransitionRequirement` (a fact compared
against a threshold, with a consequence if unmet). Rather than build two
near-identical requirement models, `TransitionRequirement` is written
generically enough to represent both "what completes this transition"
and "what makes you eligible for this opportunity" — the distinction is
which table's `id` it's attached to. This pass only wires it to
`transitions`; wiring it to a specific `capabilities` row too is Phase 2
(Gap 6), once a real opportunity actually needs eligibility gating.

### Recommendation (MVP — implemented this pass, as `recommendations`)
The Path Engine's (intelligence sense, not the business-formation
`lib/pathEngine.js`) computed output — the "what to do next" the
directive requires to be explainable, not a black box.
- Fields: `id`, `subject_id`, `goal_id`, `recommended_action`,
  `rationale`, `based_on_facts` (JSONB — which `fact_key`s and values
  were used), `based_on_constraints` (JSONB — which constraint ids),
  `missing_information` (JSONB — what facts would improve this), `computed_at`.
- Never infer without evidence: there is no confidence score field, and
  none should be added without a real statistical basis — the directive
  explicitly forbids "fake AI confidence metrics." A recommendation is
  either computable from stored rules/facts, or the engine says
  explicitly what's missing — there's no in-between numeric hedge.
- Privacy: SENSITIVE (references specific facts/constraints).
- Phase: MVP.

### Action / Task (MVP — implemented as `actions`, closing Gap 7)
The directive treats Action and Task as first-class trackable entities
(something the subject can mark done, that feeds back into state).
- Fields: `id`, `subject_id`, `goal_id`, `transition_requirement_id`
  (nullable), `recommendation_id` (nullable — which recommendation call
  produced it), `description` (copied from `action_if_unmet` at creation
  time, so it stays accurate even if the requirement's text changes
  later), `status` (`pending`/`completed`/`skipped`), `resulting_fact_id`
  (nullable), `created_at`, `completed_at`.
- `computeRecommendation()` creates or reuses a `pending` action for the
  chosen unmet requirement on every call — no duplicate rows spawn from
  recomputing the same gap repeatedly (verified in testing: calling it
  twice in a row against an unchanged state returns the same action id).
- The product decision this entity required (previously left open as
  Gap 7) is now made and enforced in code, not just documented: a
  `boolean_true` requirement's completion **is** the fact (self-reported,
  `user_provided` — never silently upgraded to `verified`) and
  auto-creates a `current_state_facts` row. A threshold requirement's
  (`gte`/`lte`/`eq`) completion is **not** treated as evidence of the new
  value — "did the activity" is not "knows the resulting number" — so no
  fact is created; the caller gets honest `guidance` asking for an
  updated fact instead. Both paths verified end-to-end: completing a
  `boolean_true` action created a real fact and the next recommendation
  moved to the following requirement; completing a threshold action left
  the underlying fact (credit score, still `580`) untouched and CHEW
  kept recommending the same real gap rather than pretending it closed.
- Phase: MVP.

### Outcome (conceptual)
What actually happened after a recommendation was acted on — needed for
the decision loop's step 9 ("observe new state") to mean anything at
scale, and eventually for evaluating whether recommendations work.
- Phase: **conceptual only**. No outcome-tracking exists. The MVP's loop
  runs once (facts in, recommendation out) — it does not close the loop
  by recording what happened next. See Gap 8.

### Income, Employment, Business, Expense, Debt, Credit profile, Asset, Property, Vehicle, Insurance, Funding (MVP, as `current_state_facts` rows, not separate tables)
The directive lists these as distinct entities. In the MVP they are
**represented as typed facts**, not separate tables — `fact_key` values
like `employment_status`, `monthly_income_cents`, `credit_score`,
`down_payment_savings_cents` are rows in `current_state_facts`, not
columns in a dozen new tables. This is a deliberate simplification: a
generic typed-fact model can represent all of these today with zero
schema changes per new fact type, at the cost of weaker typing (see Gap
2). The moment any one of these needs its own relationships (a Business
needs its own row so `capability_provider_links` can reference "this
specific business," not just "a fact about income") is exactly the
moment it graduates to a real table — Phase 2, driven by an actual need,
not speculatively built now for all eleven at once.

### Education, Skill, Credential (Phase 2, no table this pass)
Same reasoning as above — representable as facts today
(`highest_credential`, `has_ged`), promotable to real tables once
`education_programs` (already schema-only in `db/schema.sql` from the
Path Engine work) has real data to join against.

### Document (conceptual)
A file or verification artifact (proof of income, a signed form). No
file storage exists in this repository (no S3/blob integration). Not
built. Gap 9.

### Provider, Program, Product, Service, Capability, Event, Life event, Relationship, Location, Deadline
Provider/Capability: **already built** — `network_providers` and
`capabilities` in `CAPABILITY_NETWORK.md`. Program: schema-only
`education_programs` from `PATH_ENGINE.md`. Product/Service: not
separately modeled — treated as what a `capability` represents.
Event/Life event: conceptual, matches the "life moment" storytelling
from prior directives — no schema, because no real life-event catalog
exists to seed (same reasoning as the Life Map: building the shell
without real content would be indistinguishable from fabricating
progress). Relationship (between people, e.g. household members): not
built (see Household, above). Location: represented today only as
`jurisdictions` (country/state/county/city) from the Path Engine —
sufficient for the MVP; no separate `locations` table needed yet.
Deadline: represented inline as a field (`target_date` on Goal,
`expiration_date` on `path_requirements`) rather than a first-class
entity — nothing in this repository yet needs deadline logic (reminders,
overdue detection) that would justify its own table.

---

## 4. Proposed database model (MVP, this pass)

```
intel_subjects
  id, label, created_at

transitions
  id, slug, name, from_state_label, to_state_label, description, category, created_at

transition_requirements
  id, transition_id -> transitions,
  requirement_key, label, comparison, required_value, unit,
  sequence_order, action_if_unmet, created_at

goals
  id, subject_id -> intel_subjects, transition_id -> transitions (nullable),
  title, category, priority, target_date, status, created_at

current_state_facts
  id, subject_id -> intel_subjects,
  fact_key, fact_value, fact_type, source_note, recorded_at

constraints
  id, subject_id -> intel_subjects, goal_id -> goals (nullable),
  constraint_type, description, is_resolved,
  blocks_transition_id -> transitions (nullable),
  created_at, resolved_at

recommendations
  id, subject_id -> intel_subjects, goal_id -> goals,
  recommended_action, rationale,
  based_on_facts, based_on_constraints, missing_information (jsonb),
  computed_at
```

Full DDL with constraints and comments lives in `db/schema.sql`, appended
in this pass, following the existing repository convention (sequential
`CREATE TABLE IF NOT EXISTS` blocks with a header comment explaining the
migration's honesty rules — same pattern as the Path Engine and
Capability Network sections).

## 5–10. State / Transition / Goal / Constraint / Opportunity / Eligibility models

Covered in §1–3 per-entity above — each model is the entity's field list
plus its `CHECK` constraints. Nothing in this section is a separate
concern from the entity definitions; splitting them out here would just
repeat §1–3.

## 11. Capability registry relationship

**Built.** `transition_requirements.capability_id` links a requirement
directly to an existing `capabilities` row. When
`lib/intelligenceEngine.js`'s chosen unmet requirement carries that
link, it calls `lib/capabilityGraph.js`'s `getRoutingRecommendation()`
— the same function `api/capability-routing.js` already uses — so there
is exactly one code path that turns a capability slug into real provider
data, not two. The actual query shape, now live:

```
transition_requirements row with capability_id set
  (e.g. 'bookkeeping_current' -> capabilities.slug 'accounting_tax')
   -> getRoutingRecommendation({ capabilitySlug })
   -> capability_provider_links WHERE capability_id = X
   -> network_providers WHERE status = 'active' AND is_ready = TRUE
   -> attached to the recommendation as `relatedCapability`
      (available + provider list, or honestly available: false)
```

Verified end-to-end, including live: seeded a real `network_providers`
row mid-test (status `active`, `is_ready = TRUE`) linked to
`accounting_tax`, and confirmed the next `computeRecommendation()` call
against the same goal picked it up automatically — `relatedCapability
.available` flipped from `false` to `true` with zero code change,
because the intelligence engine never caches or duplicates registry
data, it queries it fresh every call.

What's still narrow: only a requirement an author has explicitly set
`capability_id` on gets this treatment — there's no inference that
guesses "this requirement is probably about insurance" from its
`requirement_key` or label. That's a deliberate boundary, not a
missing feature — auto-matching risks a wrong match presented as
confident routing, which is exactly the kind of unearned certainty this
architecture is built to avoid.

This pass's MVP slice does not exercise this path (no
`transition_requirement` in the seed data maps to a real `capabilities`
slug yet, because doing so would require a transition whose
requirements are genuinely fulfilled by an existing capability — forcing
that mapping for the sake of demonstrating it would be exactly the kind
of speculative wiring this directive warns against). The mapping is
straightforward (`requirement_key` matching a `capabilities.slug`) and
is documented here so the next implementation milestone (§19) can wire
it without a redesign.

## 12. The seven intelligence engines

| Engine | This pass | Notes |
|---|---|---|
| **State Engine** | **Built.** `current_state_facts` + its `fact_type` provenance model *is* the State Engine — there's no separate "engine" code beyond the schema and a read helper, because distinguishing fact provenance is a data-modeling problem, not a computation. |
| **Goal Engine** | **Built (data model only).** `goals` table. Goal *conflict detection* (the directive's homebuying-vs-business-vs-financing example) is Phase 2 — it requires a rule for every pairwise category interaction, and this pass has exactly one transition defined, not enough breadth to write real conflict rules against. Documented as Gap 11, not built speculatively. |
| **Readiness Engine** | **Built, folded into the recommendation engine.** Readiness for a transition is computed by evaluating every `transition_requirements` row against `current_state_facts` — met/unmet, with the exact fact and threshold cited. There is no separate readiness percentage; the directive explicitly asks for "you are not ready because of X, Y, Z," not a score, and that's exactly what `lib/intelligenceEngine.js` returns. |
| **Constraint Engine** | **Built (data model + resolution status), leverage ranking simplified.** Constraints are typed and can block a specific transition. Ranking by true leverage (§ TransitionRequirement above) is replaced by author-assigned `sequence_order` in the MVP — named as a simplification, not hidden. |
| **Opportunity Engine** | **Wired.** A `transition_requirements` row may name a `capability_id`; when the engine's chosen unmet requirement carries one, `computeRecommendation()` calls `lib/capabilityGraph.js`'s already-tested `getRoutingRecommendation()` directly — no second, forked opportunity model. Verified end-to-end, including live: seeded a real `network_providers` row mid-test and confirmed the next call to `computeRecommendation()` picked it up and flipped `relatedCapability.available` from `false` to `true` with zero code change. Still narrow — only requirements an author has explicitly linked to a capability get this treatment; there's no automatic matching of a requirement to a capability by inference. |
| **Unlock Engine** | **Built, as a byproduct of the Readiness Engine.** "What's unmet and what closes the gap" *is* `action_if_unmet` on the first unmet `transition_requirements` row by `sequence_order`. There's no separate Unlock Engine module in this pass — the directive's own example output format (LOCKED / WHY / CURRENT / REQUIRED / NEXT MOVE) maps field-for-field onto `computeRecommendation()`'s return shape (see `lib/intelligenceEngine.js`). |
| **Path Engine (intelligence sense)** | **Not built this pass** — name collision worth flagging explicitly: `lib/pathEngine.js` already exists in this repo for business-formation path lookups (a different, narrower concept — a fixed sequence of legal/regulatory steps). The intelligence-sense Path Engine (best-next-move across multiple weighted factors: cost, time, risk, reversibility) is Phase 2+ and needs a real multi-factor ranking model this pass does not attempt. The MVP's "recommended next action" is the *single* nearest unmet requirement, not a ranked path through several — that's the honest boundary of what's built. |

## 13. Decision loop

The directive's 10-step loop, annotated with what's real in this pass:

1. Observe current state — **built** (`current_state_facts`).
2. Understand goals — **built** (`goals`).
3. Detect constraints — **built** (`constraints`, plus unmet
   `transition_requirements` computed live).
4. Identify opportunities — **wired** (see Opportunity Engine row above), narrow: only for a requirement an author explicitly linked to a capability.
5. Determine unlock conditions — **built** (`action_if_unmet` on the
   nearest unmet requirement).
6. Rank possible actions — **simplified** (`sequence_order`, not true
   multi-factor ranking).
7. Recommend best next move — **built**, with the honesty caveat that
   "best" means "highest-priority unmet requirement by author-assigned
   order," not an optimized best.
8. Record action — **built** (`actions`, closing Gap 7 — see the
   Action/Task entity above). `completeAction()` records completion and,
   for a `boolean_true` requirement, the resulting fact.
9. Observe new state — **built for the pull case**: `api/intelligence-actions.js`'s
   `POST` handler calls `completeAction()` and then immediately
   re-invokes `computeRecommendation()` for the same goal in the same
   round trip, so a caller always sees the post-completion state without
   a second request — verified end-to-end. What's still not built: a
   change that happens *outside* an action completion (a subject just
   reports a new fact directly) doesn't automatically trigger anything;
   nothing observes it until something calls `computeRecommendation()`
   again (Gap 8 narrows to this: no push/event trigger, not "can't
   observe new state" generally).
10. Recalculate path — **built**: the engine is stateless and
    idempotent, and now demonstrated live — completing the
    `bookkeeping_current` action caused the very next recommendation for
    that goal to move on to `has_business_bank_account`, the correct
    next unmet requirement by `sequence_order`. Still not built:
    proactively noticing a change and pushing a new recommendation
    without being asked (Gap 12).

The loop is **not a background process** in this pass — there's no
scheduler, no event system, no push notification path in this
repository. `computeRecommendation()` and `completeAction()` are both
pull-based, called on demand. Making the loop push-based end-to-end
(react to any new fact, not just an action completion routed through
this API) is Phase 2+ infrastructure this repo doesn't have yet (Gap 12).

## 14. Explainability / audit requirements

Every `recommendations` row is self-contained evidence: `based_on_facts`
and `based_on_constraints` store the exact `fact_key`/value pairs and
constraint ids the engine used, not just the conclusion. This means a
recommendation can be audited later without re-running the engine or
trusting a log line — verified in testing by inspecting a stored
recommendation's JSONB columns directly. No recommendation is ever
generated without this trail; the engine has no code path that returns
a bare string.

## 15. Privacy / security considerations

- **No RESTRICTED-class data is collected anywhere in this schema** (no
  SSN, no full account numbers). If a future fact needs one, it needs
  its own encryption-at-rest design before that column is added — not
  retrofitted after.
- **SENSITIVE data (most of `current_state_facts` and `constraints`) has
  no additional protection beyond what the rest of this repo's Postgres
  connection already has** (`ssl: { rejectUnauthorized: false }` in
  `lib/db.js`, same as every other table). Field-level encryption,
  row-level access control, and data-retention rules are **not built**
  (Gap 3) — this is named explicitly because "we modeled privacy
  classes" is not the same as "we protected the data," and conflating
  the two would misrepresent this pass's actual security posture.
- **No real subject/user identity exists** (Gap 1) — until real
  authentication exists, this schema cannot ethically hold real people's
  facts. Every row created in this pass is synthetic test data, labeled
  as such in the seed file and never to be treated as a real user
  record.
- **fact_type integrity** is the main safeguard against the directive's
  "no pretending inferred is verified" rule — enforced by a `NOT NULL`,
  enum-constrained column with a `CHECK` requiring `source_note` on any
  `verified` row (see `db/schema.sql`).

## 16. MVP vs. later phases

**MVP (built across this pass, the Opportunity Engine follow-up, and the
action/task tracking follow-up):** `intel_subjects`, `transitions`,
`transition_requirements` (with `capability_id`), `goals`,
`current_state_facts`, `constraints`, `recommendations` (with
`related_capability`), `actions`; `lib/intelligenceEngine.js`
(`computeRecommendation`, `completeAction`, `listActions`, wired to
`lib/capabilityGraph.js`); two illustrative, clearly-labeled test
transitions + one test subject; two internal (non-public) API endpoints
(`api/intelligence-recommendation.js`, `api/intelligence-actions.js`).

**Phase 2 (needs more platform maturity or real data, not more design):**
real subject identity/auth (Gap 1); typed fact columns or a validated
schema-per-`fact_key` registry instead of `TEXT` values (Gap 2);
field-level encryption / access control for SENSITIVE data (Gap 3);
transitions authorable outside a code deploy (Gap 4) — likely an admin
UI once there's more than one real transition; compound requirement
logic (AND/OR, conditional requirements) beyond simple threshold
comparison; goal conflict detection; household/multi-subject support;
Education/Skill/Credential as real tables once `education_programs` has
data; a completion flow for `gte`/`lte`/`eq` requirements that prompts
for the actual updated value rather than just returning `guidance` text
(today the guidance is generated but nothing captures the follow-up fact
in the same interaction — the subject has to make a separate call to
whatever writes `current_state_facts`, which this pass doesn't build a
public entry point for at all).

**Phase 3+ (advanced automation, integration, prediction):** outcome
tracking beyond action completion — did the *transition itself* actually
happen, evaluated over time (Gap 8, narrowed — action-level outcome
tracking is now built, transition-level is not); a live/push decision
loop reacting to any new fact, not just ones routed through
`completeAction()` (Gap 12); true leverage-based constraint ranking (a
real dependency graph across requirements); risk modeling; document
storage and verification pipelines (Gap 9); any ML-based inference — and
even then, only with a disclosed confidence/evidence model, never a bare
"AI score."

## 17–19. Reuse / modify / new

**Reused as-is:** `lib/db.js` (connection pattern), the repository's
existing `CREATE TABLE IF NOT EXISTS` + comment-header schema
convention, the existing `feature_flags` registry (this pass's API is
gated through it, not a new gating mechanism), the `jurisdictions` table
(available if a transition ever needs geography — unused by the MVP's
one test transition).

**Modified:** `db/schema.sql` (appended only — no existing table
altered), `db/seed-feature-flags.sql` (one new row).

**New, and why each is actually necessary:** `intel_subjects` (nothing
in this repo represents "a person CHEW reasons about" — `applications`
is admissions-specific and unsuitable for general fact-holding);
`transitions`/`transition_requirements` (no existing table expresses
"a state change and its conditions" — `path_requirements` is
sequence-specific to business formation, not general-purpose);
`goals`/`current_state_facts`/`constraints`/`recommendations` (net new
concepts with no analog in the existing schema); `lib/intelligenceEngine.js`
(new reasoning code — no existing engine computes an explainable
recommendation from facts+requirements); `api/intelligence-recommendation.js`
(new endpoint, following the existing `api/*.js` handler pattern exactly).

**Explicitly not touched:** `lib/pathEngine.js`, `lib/capabilityGraph.js`,
`lib/featureFlags.js`'s public API, and every existing page — this pass
is additive.

## 20. Recommended next implementation milestone

**Done #1** — Opportunity Engine wired to the capability registry (§11,
the Opportunity Engine row in §12's table). `transition_requirements
.capability_id` links a requirement to a real `capabilities` row;
`computeRecommendation()` calls `lib/capabilityGraph.js`'s existing
`getRoutingRecommendation()` directly; verified live by seeding a real
provider mid-test and watching the next recommendation call pick it up
with zero code change.

**Done #2** — action/task tracking with a completion → fact-update flow
(closed Gap 7; see the Action/Task entity above and decision-loop steps
8–10). The open question this milestone was blocked on — does a
completed action create a fact automatically, or require confirmation
first — is now answered and enforced in code, not left as a silent
default: `boolean_true` completions auto-create a `user_provided` fact
(the action *is* the fact); threshold (`gte`/`lte`/`eq`) completions
never do (doing the work isn't knowing the result), returning honest
`guidance` instead. Verified end-to-end for both branches, including
that a threshold completion leaves the real fact value genuinely
unchanged rather than fabricating progress.

**Next candidate milestone:** give threshold-requirement completions
somewhere to actually send the follow-up value. Right now
`completeAction()` correctly *refuses* to guess a new credit score or
savings balance, but there's no public entry point in this repository
for a subject to then report that updated number — the only way a
`current_state_facts` row gets written today is a direct database
insert (as the seed files do) or an auto-created `boolean_true`
completion. A small `POST /api/intelligence-facts` (or extending
`api/intelligence-actions.js`'s completion payload to optionally accept
`{ factValue }` for threshold requirements) would close that gap without
touching the comparison/evaluation logic already built and tested. This
is a smaller, narrower milestone than Gap 1 (real identity) or Gap 4
(transitions authorable outside a deploy) and doesn't require a new
product decision — the honesty rule (never infer a threshold value) is
already decided; this just gives the subject a legitimate way to supply
it themselves.

## Testing performed

No automated test suite or build step exists in this repo. Verified
with real, scripted tests against a live local PostgreSQL 16 database:

- Full `db/schema.sql` (including all six new intelligence tables and
  their `CHECK` constraints) applied cleanly from scratch.
- Confirmed the `verified`-fact-requires-`source_note` constraint
  rejects an invalid insert and accepts a valid one.
- A real bug was caught and fixed by this testing, not by inspection:
  the initial schema made `recommendations.recommended_action`
  `NOT NULL`, but "every requirement is met, nothing to recommend" is a
  legitimate outcome the engine correctly produces a `null` action for
  — the insert failed with a real Postgres constraint violation the
  first time that code path actually ran. Fixed by making the column
  nullable (a `NULL` recommended_action is meaningful, not an error
  state) and reverified.
- `computeRecommendation()` exercised end-to-end against the seeded
  illustrative scenario: confirmed it correctly identifies `credit_score`
  (sequence 2) as the highest-priority unmet requirement — skipping the
  already-met `documented_income` (sequence 1) — correctly lists
  `down_payment_savings_cents` under `missingInformation` (no fact
  exists for it at all, distinct from "exists but doesn't meet
  threshold"), correctly surfaces the one unresolved constraint, and
  persists a real row in `recommendations` with the same data returned
  to the caller. Also verified the "all requirements met" path (fresh
  facts satisfying every requirement) returns `recommendedAction: null`
  with an honest rationale, and that a nonexistent goal id raises a
  clear error rather than a silent wrong answer.
- `api/intelligence-recommendation.js` verified through the full flag
  lifecycle: `404` while `intelligence_engine` is `internal` (its
  correct default — see §16 and the seed file), `200` with the same
  explainable data once flipped to `preview`, `404` again once restored
  to `internal`, plus `400` on non-integer `subjectId`/`goalId`.
- **Opportunity Engine wiring (§11), re-verified after adding it:**
  applied the updated schema (`transition_requirements.capability_id`,
  `recommendations.related_capability`) cleanly; confirmed the second
  seeded transition's `bookkeeping_current` requirement correctly links
  to the `accounting_tax` capability; confirmed
  `computeRecommendation()` returns `relatedCapability: null` for the
  first (unlinked) scenario — a regression check on already-tested
  behavior — and a real, non-null `relatedCapability` object for the
  second, honestly reporting `available: false` while
  `network_providers` is empty. Then seeded one real `active`/`is_ready`
  provider mid-test and re-ran the same call: `relatedCapability
  .available` flipped to `true` with 1 provider, with no code change —
  proof the engine reads the registry live rather than caching a stale
  answer. Re-ran the full prior test suite afterward to confirm no
  regressions.
- **Action/task tracking, re-verified after adding it:** applied the
  updated schema (`actions` table plus its two `CHECK` constraints) and
  confirmed both reject an invalid row (a `pending` action with
  `completed_at` set; a `completed` action without it) as well as a
  `resulting_fact_id` set on a still-`pending` action. Exercised the
  full loop against the live seeded data: `computeRecommendation()`
  creates a pending action for `bookkeeping_current`; calling it again
  unchanged reuses the same action id rather than duplicating it;
  completing that (`boolean_true`) action auto-created a real
  `current_state_facts` row and the *next* `computeRecommendation()`
  call correctly advanced to `has_business_bank_account`, the following
  requirement by `sequence_order`; attempting to complete the same
  action twice correctly raised an error instead of silently
  succeeding. Separately verified the threshold branch: completing the
  `credit_score` (`gte`) action returned `factCreated: false` and honest
  `guidance` text, and a follow-up recommendation call confirmed the
  underlying `credit_score` fact was genuinely untouched (still `580`)
  and CHEW kept recommending the same real gap. `api/intelligence-actions.js`
  verified for `GET` (list, with and without a status filter, `400` on
  an invalid one), `POST` (completion + recomputed recommendation in one
  response, `404` on a nonexistent action, `409` on a not-pending one),
  and `405` on an unsupported method — plus confirmed the flag-gate
  itself (not just application logic) produces the `404` when
  `intelligence_engine` is `internal`, by first hitting it un-flipped and
  getting `{"error":"Not found"}` before flipping the flag for the rest
  of the test.
- No local test infrastructure (Postgres cluster, scratch database) is
  part of this repository.
