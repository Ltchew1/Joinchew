-- CHEW booking system schema
-- Run this once against your Postgres database (Vercel Postgres, Supabase, or any
-- standard Postgres) before the booking flow will work end-to-end.

CREATE TABLE IF NOT EXISTS bookings (
  id              SERIAL PRIMARY KEY,
  tier            TEXT NOT NULL CHECK (tier IN ('strategy', 'growth', 'executive')),
  client_name     TEXT NOT NULL,
  client_email    TEXT NOT NULL,
  notes           TEXT,
  slot_start      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
  stripe_session_id TEXT,
  stripe_payment_id TEXT,
  amount_cents    INTEGER,
  reminder_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

-- Prevents two confirmed/pending bookings from ever holding the exact same slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_slot
  ON bookings (slot_start)
  WHERE status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_slot_start ON bookings (slot_start);

-- CHEW admissions system schema
-- Run this once to add the /apply pipeline: form submissions, AI readiness
-- scoring (Claude API), and the human-reviewed decision.

CREATE TABLE IF NOT EXISTS applications (
  id                  SERIAL PRIMARY KEY,
  access_token        TEXT UNIQUE,
  full_name           TEXT NOT NULL,
  email               TEXT NOT NULL,
  phone               TEXT,
  answers             JSONB NOT NULL,

  -- AI readiness scoring (Claude API) — advisory only, never shown to applicants
  ai_score            INTEGER,
  ai_dimension_scores JSONB,
  ai_recommendation   TEXT CHECK (ai_recommendation IN ('ACCEPT', 'ACCEPT_WITH_CONDITIONS', 'WAITLIST', 'REFER_ELSEWHERE', 'REAPPLY_LATER')),
  ai_conditions       JSONB,
  ai_rationale        TEXT,
  ai_one_flag         TEXT,
  ai_one_strength     TEXT,
  ai_scored_at        TIMESTAMPTZ,
  ai_error            TEXT,

  -- Human decision — a person must review every AI recommendation before this is set
  status              TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'scored', 'decided')),
  decision            TEXT CHECK (decision IN ('ACCEPT', 'ACCEPT_WITH_CONDITIONS', 'WAITLIST', 'REFER_ELSEWHERE', 'REAPPLY_LATER')),
  decision_note       TEXT,
  decided_at          TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications (created_at);

-- CHEW post-acceptance program purchases
-- Run this once to add the tier-selection + payment pipeline that begins
-- after an application is accepted: entry fee -> (for Infrastructure/
-- Executive) a separate remainder payment offering card/Klarna/Afterpay, or
-- (for Membership) a $97/mo subscription that auto-starts 30 days after
-- the entry fee.

CREATE TABLE IF NOT EXISTS program_purchases (
  id                          SERIAL PRIMARY KEY,
  access_token                TEXT UNIQUE NOT NULL,
  application_id              INTEGER REFERENCES applications (id),
  tier                        TEXT NOT NULL CHECK (tier IN ('infrastructure', 'executive', 'membership')),
  client_name                 TEXT NOT NULL,
  client_email                TEXT NOT NULL,

  -- Entry fee (all tiers)
  entry_amount_cents          INTEGER NOT NULL,
  entry_stripe_session_id     TEXT,
  entry_paid_at               TIMESTAMPTZ,

  -- Remainder payment (infrastructure/executive only)
  remainder_amount_cents      INTEGER,
  remainder_stripe_session_id TEXT,
  remainder_paid_at           TIMESTAMPTZ,
  remainder_payment_method    TEXT CHECK (remainder_payment_method IN ('card', 'klarna', 'afterpay_clearpay')),
  bonus_session_earned        BOOLEAN NOT NULL DEFAULT FALSE,
  bonus_session_scheduled     BOOLEAN NOT NULL DEFAULT FALSE,

  -- Membership subscription (membership only)
  stripe_customer_id          TEXT,
  stripe_subscription_id      TEXT,
  membership_first_charge_at  TIMESTAMPTZ,
  membership_reminder_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  membership_status           TEXT CHECK (membership_status IN ('trialing', 'active', 'paused', 'cancelled')),

  status                      TEXT NOT NULL DEFAULT 'pending_entry'
                                CHECK (status IN ('pending_entry', 'pending_remainder', 'complete')),

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_program_purchases_status ON program_purchases (status);
CREATE INDEX IF NOT EXISTS idx_program_purchases_application ON program_purchases (application_id);

-- CHEW Client Services Agreement e-signatures
-- Run this once to add the signature step that sits between program
-- selection and entry-fee payment (see sign-agreement.html,
-- api/sign-agreement.js). create-program-checkout-session.js requires a
-- matching row here before it will create a checkout session for a given
-- application + tier.

CREATE TABLE IF NOT EXISTS agreement_signatures (
  id                 SERIAL PRIMARY KEY,
  application_id     INTEGER NOT NULL REFERENCES applications (id),
  tier               TEXT NOT NULL CHECK (tier IN ('infrastructure', 'executive', 'membership')),
  signed_name        TEXT NOT NULL,
  agreement_version  TEXT NOT NULL,
  ip_address         TEXT,
  user_agent         TEXT,
  signed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_signatures_application ON agreement_signatures (application_id);

ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS agreement_signature_id INTEGER REFERENCES agreement_signatures (id);

-- ============================================================
-- CHEW Path Engine — jurisdiction, source, and requirement model
-- ============================================================
-- Foundation for the business-formation / licensing / education /
-- career pathfinder. Run this once to add the schema.
--
-- Data-honesty rules this design enforces:
--   - Every fact-bearing row in path_requirements must reference a
--     `sources` row with a real authority_level and url — there is
--     no free-text "trust me" field.
--   - verification_status distinguishes a manually-verified fact
--     from a placeholder. The UI must never present a
--     'general_guidance' row as verified.
--   - education_programs, careers, and jobs are intentionally
--     EMPTY as of this migration. Do not seed them with invented
--     programs, careers, or job listings — they exist so a real
--     future integration has a schema to land in without a
--     rewrite. See PATH_ENGINE.md for what is and isn't populated.

CREATE TABLE IF NOT EXISTS jurisdictions (
  id         SERIAL PRIMARY KEY,
  country    TEXT NOT NULL DEFAULT 'US',
  state      TEXT,           -- e.g. 'FL'; NULL for a national/federal-level row
  county     TEXT,
  city       TEXT,
  label      TEXT NOT NULL,  -- human-readable, e.g. "United States (Federal)", "Florida", "Orlando, FL"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country, state, county, city)
);

CREATE TABLE IF NOT EXISTS sources (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,  -- e.g. "IRS", "Florida Division of Corporations"
  authority_level TEXT NOT NULL CHECK (authority_level IN ('A', 'B', 'C', 'D')),
  -- A: official government / regulator / licensing authority
  -- B: official school, accreditor, certification body, or recognized institution
  -- C: licensed commercial data provider
  -- D: secondary / community source
  url             TEXT NOT NULL,
  jurisdiction_id INTEGER REFERENCES jurisdictions (id),  -- NULL for a national/federal source
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_types (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,  -- e.g. 'llc-formation', 'cleaning-service'
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('general_formation', 'lower_regulation', 'professional_licensed', 'heavily_regulated')),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS path_requirements (
  id                   SERIAL PRIMARY KEY,
  business_type_id     INTEGER NOT NULL REFERENCES business_types (id),
  jurisdiction_id      INTEGER NOT NULL REFERENCES jurisdictions (id),
  name                 TEXT NOT NULL,  -- e.g. "Employer Identification Number (EIN)"
  requirement_type     TEXT NOT NULL CHECK (requirement_type IN ('required', 'recommended', 'optional_advantage')),
  issuing_authority    TEXT NOT NULL,  -- e.g. "Internal Revenue Service"
  source_id            INTEGER NOT NULL REFERENCES sources (id),
  cost_cents           INTEGER,        -- NULL if free or cost genuinely varies (see cost_notes)
  cost_notes           TEXT,
  renewal_period       TEXT,           -- e.g. "Annual", "One-time"; NULL if not applicable
  sequence_order       INTEGER NOT NULL DEFAULT 0,
  depends_on_id        INTEGER REFERENCES path_requirements (id),  -- self-reference for step dependencies
  documents_needed     JSONB,          -- array of strings
  official_action_url  TEXT,           -- direct link to the official application/portal
  notes                TEXT,
  verification_status  TEXT NOT NULL CHECK (verification_status IN ('verified', 'manually_verified', 'general_guidance')),
  last_verified_at     TIMESTAMPTZ,
  effective_date       DATE,
  expiration_date      DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_path_requirements_lookup ON path_requirements (business_type_id, jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_path_requirements_sequence ON path_requirements (business_type_id, jurisdiction_id, sequence_order);

-- ---------- Schema-only: intentionally unpopulated (see header note) ----------

CREATE TABLE IF NOT EXISTS education_programs (
  id                       SERIAL PRIMARY KEY,
  institution              TEXT NOT NULL,
  program_name             TEXT NOT NULL,
  credential               TEXT,
  accreditation            TEXT,
  jurisdiction_id          INTEGER REFERENCES jurisdictions (id),
  duration                 TEXT,
  cost_cents               INTEGER,
  application_requirements JSONB,
  source_id                INTEGER REFERENCES sources (id),
  last_verified_at         TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS careers (
  id                     SERIAL PRIMARY KEY,
  title                  TEXT NOT NULL,
  education_path         TEXT,
  licensing_requirements JSONB,
  certifications         JSONB,
  prep_time              TEXT,
  common_progression     TEXT,
  source_id              INTEGER REFERENCES sources (id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Integration-ready shape for a future real job feed. `source_name` and
-- `source_timestamp` are NOT NULL by design — a row cannot exist without
-- attribution and a freshness timestamp. Never insert placeholder/sample
-- rows here; the API must return an empty list rather than seed fixtures.
CREATE TABLE IF NOT EXISTS jobs (
  id                         SERIAL PRIMARY KEY,
  title                      TEXT NOT NULL,
  employer                   TEXT,
  location                   TEXT,
  compensation_notes         TEXT,
  education_requirement      TEXT,
  certification_requirement  TEXT,
  source_name                TEXT NOT NULL,
  source_timestamp           TIMESTAMPTZ NOT NULL,
  apply_url                  TEXT,
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'filled')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- CHEW Capability Network — routing, affiliation & disclosure model
-- ============================================================
-- Foundation for routing a client to the right execution capability
-- (an affiliated company, a licensed specialist, an outside provider)
-- without collapsing the identity of separately operated companies into
-- "CHEW Partners," and without ever hiding a material affiliation.
--
-- Data-honesty / disclosure rules this design enforces:
--   - relationship_classification records the true legal/operational
--     relationship for every provider. It is never invented — a
--     provider row must not exist until someone with real authority to
--     classify that relationship has done so.
--   - An 'affiliated_enterprise' provider MUST carry disclosure_text
--     (enforced by CHECK below). There is no path to route a client to
--     an affiliated company without a disclosure to show them.
--   - status controls exposure, not just labeling: only 'active'
--     providers are ever returned by lib/capabilityGraph.js queries.
--     'coming_soon' and 'hidden' providers are filtered out in SQL, so
--     they cannot leak through the API even via a direct/crafted
--     request — see CAPABILITY_NETWORK.md.
--   - As of this migration, network_providers is intentionally EMPTY.
--     Do not seed a provider row with an invented company, licensing
--     status, or disclosure — that data can only come from whoever
--     actually holds the business relationship. See
--     CAPABILITY_NETWORK.md for exactly what is and isn't populated.

CREATE TABLE IF NOT EXISTS capabilities (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,  -- e.g. 'insurance_risk_review', 'digital_business_infrastructure'
  name        TEXT NOT NULL,
  category    TEXT,                  -- freeform grouping, e.g. 'risk', 'infrastructure', 'real_assets', 'tax_accounting'
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS network_providers (
  id                         SERIAL PRIMARY KEY,
  slug                       TEXT UNIQUE NOT NULL,
  name                       TEXT NOT NULL,
  relationship_classification TEXT NOT NULL CHECK (relationship_classification IN
                                 ('chew_direct', 'affiliated_enterprise', 'independent_professional',
                                  'external_provider', 'future_managed_service')),
  status                     TEXT NOT NULL DEFAULT 'hidden' CHECK (status IN ('active', 'coming_soon', 'hidden')),
  jurisdiction_id            INTEGER REFERENCES jurisdictions (id),  -- NULL if not jurisdiction-limited
  licensing_notes            TEXT,
  disclosure_text            TEXT,  -- shown to the client before/at handoff when material
  contact_method             TEXT,  -- how a handoff actually reaches this provider
  intake_process_notes       TEXT,
  data_sharing_notes         TEXT,  -- what client data this provider needs, in plain language
  is_ready                   BOOLEAN NOT NULL DEFAULT FALSE,  -- all PROVIDER READINESS checks passed
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (relationship_classification <> 'affiliated_enterprise' OR disclosure_text IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_network_providers_status ON network_providers (status);

-- One registry, two audiences: `status` gates public-website exposure;
-- `portal_visibility` is a SEPARATE gate for a future authenticated
-- portal, so a provider can be shown to existing clients in the portal
-- before (or without ever) appearing on the public marketing site, or
-- vice versa. No portal exists in this repository yet to consume this —
-- it's added now so the registry doesn't need a breaking schema change
-- when one does. entity_type is free-text (e.g. 'llc', 'individual',
-- 'nonprofit') since real values depend on real providers that don't
-- exist yet; do not invent a CHECK-constrained enum for values nobody
-- has confirmed.
ALTER TABLE network_providers ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE network_providers ADD COLUMN IF NOT EXISTS portal_visibility BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS capability_provider_links (
  id                 SERIAL PRIMARY KEY,
  capability_id      INTEGER NOT NULL REFERENCES capabilities (id),
  provider_id        INTEGER NOT NULL REFERENCES network_providers (id),
  eligibility_notes  TEXT,   -- what client profile this fits
  prerequisite_notes TEXT,   -- what must be true/done before this becomes relevant
  documents_needed   JSONB,
  priority           INTEGER NOT NULL DEFAULT 0,  -- lower routes first when multiple providers match
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (capability_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_capability_provider_links_capability ON capability_provider_links (capability_id);

-- Consent log for sharing client data with an external/affiliated provider.
-- A row here is the record that a specific client was shown what would be
-- shared and agreed to it, before any handoff occurred.
CREATE TABLE IF NOT EXISTS routing_consents (
  id                  SERIAL PRIMARY KEY,
  application_id      INTEGER REFERENCES applications (id),
  capability_id       INTEGER NOT NULL REFERENCES capabilities (id),
  provider_id         INTEGER NOT NULL REFERENCES network_providers (id),
  data_shared_summary TEXT NOT NULL,  -- plain-language description shown to the client at consent time
  consented_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address          TEXT,
  user_agent          TEXT
);

CREATE INDEX IF NOT EXISTS idx_routing_consents_application ON routing_consents (application_id);

-- Routing analytics stub: one row per routing decision, including the
-- honest "not needed yet" and "no provider available" outcomes — this is
-- not just a success log.
CREATE TABLE IF NOT EXISTS routing_events (
  id             SERIAL PRIMARY KEY,
  capability_id  INTEGER REFERENCES capabilities (id),
  provider_id    INTEGER REFERENCES network_providers (id),  -- NULL when outcome isn't a routed match
  application_id INTEGER REFERENCES applications (id),
  outcome        TEXT NOT NULL CHECK (outcome IN ('routed', 'not_yet_needed', 'no_provider_available')),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_events_capability ON routing_events (capability_id);

-- ============================================================
-- CHEW Feature Flags — shared feature-status registry
-- ============================================================
-- "Hidden UI is not security." Any not-yet-launched feature must be
-- unreachable at the API layer, not merely unlinked from navigation.
-- lib/featureFlags.js is the only supported way to read these — API
-- handlers call isFeatureActive(slug) and return 404 when false, so a
-- disabled feature is genuinely unreachable, not just hard to find.
--
-- This is also the single source of truth for the homepage's
-- "coming soon" cards — see api/feature-flags.js and index.html. A
-- card's title/description/status is READ from this table, not
-- hard-coded per page, so a launch is one row update, not a redesign.
--
-- status meanings (least to most available):
--   internal — not built for production, not publicly teased at all,
--              regardless of public_teaser_enabled
--   locked   — publicly teased (a "Coming Soon" card) but the API
--              behind it still 404s
--   preview  — a narrow, honestly-labeled early-access slice is real
--              and API-accessible (e.g. one jurisdiction, zero
--              seeded providers) — this is NOT "fully live"
--   beta     — broader real access, still flagged as evolving
--   live     — fully live, no caveats
--
-- API access (lib/featureFlags.js isFeatureActive) is granted for
-- 'preview', 'beta', and 'live' — never for 'internal' or 'locked'.
--
-- public_teaser_enabled is a SEPARATE axis from status: a feature can
-- be built and even API-accessible while still not shown publicly
-- (public_teaser_enabled = FALSE), and a feature can be publicly
-- teased as "Coming Soon" while still 100% locked at the API
-- (status = 'locked', public_teaser_enabled = TRUE). Do not flip
-- status or public_teaser_enabled without being told to, and never
-- seed 'preview'/'beta'/'live' for something that hasn't actually
-- been verified working.

CREATE TABLE IF NOT EXISTS feature_flags (
  id                   SERIAL PRIMARY KEY,
  slug                 TEXT UNIQUE NOT NULL,
  name                 TEXT NOT NULL,  -- internal name, not shown publicly
  status               TEXT NOT NULL DEFAULT 'internal'
                          CHECK (status IN ('internal', 'locked', 'preview', 'beta', 'live')),
  public_teaser_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  public_title         TEXT,   -- required if public_teaser_enabled; shown on the "What's Next" card
  public_description   TEXT,   -- required if public_teaser_enabled; shown on the "What's Next" card
  category             TEXT,
  release_note         TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT public_teaser_enabled OR (public_title IS NOT NULL AND public_description IS NOT NULL)),
  CHECK (status <> 'internal' OR NOT public_teaser_enabled)
);

-- ============================================================
-- CHEW Intelligence System — MVP slice
-- ============================================================
-- Implements exactly one bounded, end-to-end-testable slice of the
-- architecture in ARCHITECTURE.md: Goal + Current State + Constraint +
-- Transition + explainable Recommended Next Action. Read
-- ARCHITECTURE.md before extending this — it documents what's
-- deliberately simplified (sequence_order standing in for true
-- leverage ranking; no goal-conflict detection; no Opportunity Engine
-- wiring yet) and why, so the next person doesn't "fix" a boundary that
-- was intentional.
--
-- Data-honesty rules this design enforces:
--   - intel_subjects has NO real authentication behind it. Every row
--     created against this schema in this repository is synthetic
--     test/example data — see db/seed-intelligence.sql's header. Do
--     not attach a real person's facts to this schema until real
--     identity/auth exists (ARCHITECTURE.md Gap 1).
--   - current_state_facts.fact_type distinguishes user_provided /
--     verified / computed / inferred and must never be mixed or
--     silently upgraded. A 'verified' fact must cite what verified it
--     (enforced by CHECK below) — there is no automated verification
--     pipeline in this repository, so any 'verified' row anyone adds is
--     only as trustworthy as the human who labeled it that way.
--   - recommendations always stores its own evidence (based_on_facts /
--     based_on_constraints / missing_information) — there is no code
--     path that returns a recommendation without it. No confidence
--     score field exists anywhere in this schema; do not add one
--     without a real statistical basis behind it.

CREATE TABLE IF NOT EXISTS intel_subjects (
  id         SERIAL PRIMARY KEY,
  label      TEXT NOT NULL,  -- e.g. "TEST SUBJECT — illustrative only", never a real name until real auth exists
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transitions (
  id               SERIAL PRIMARY KEY,
  slug             TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  from_state_label TEXT NOT NULL,
  to_state_label   TEXT NOT NULL,
  description      TEXT,
  category         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transition_requirements (
  id               SERIAL PRIMARY KEY,
  transition_id    INTEGER NOT NULL REFERENCES transitions (id),
  requirement_key  TEXT NOT NULL,  -- matches a current_state_facts.fact_key
  label            TEXT NOT NULL,
  comparison       TEXT NOT NULL CHECK (comparison IN ('gte', 'lte', 'eq', 'boolean_true')),
  required_value   TEXT NOT NULL,  -- compared against the fact's value per `comparison`; cast at read time
  unit             TEXT,
  sequence_order   INTEGER NOT NULL DEFAULT 0,  -- the MVP's entire leverage model — see ARCHITECTURE.md
  action_if_unmet  TEXT NOT NULL,  -- author-written next-step text; no NLG
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transition_requirements_lookup
  ON transition_requirements (transition_id, sequence_order);
-- db/seed-intelligence.sql's INSERTs into this table already declare
-- ON CONFLICT DO NOTHING, but that clause is a silent no-op without a
-- real matching constraint to target — this repo's own scratch test
-- database ended up with 3x-duplicated rows here from repeated re-seeds
-- before this index existed. Adding it makes the seed file's existing
-- ON CONFLICT clauses actually idempotent, as originally intended.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transition_requirements
  ON transition_requirements (transition_id, requirement_key);

CREATE TABLE IF NOT EXISTS goals (
  id            SERIAL PRIMARY KEY,
  subject_id    INTEGER NOT NULL REFERENCES intel_subjects (id),
  transition_id INTEGER REFERENCES transitions (id),  -- nullable: a goal can predate a matched transition
  title         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN
                   ('employment', 'business', 'credit', 'housing', 'education', 'assets', 'other')),
  priority      INTEGER NOT NULL DEFAULT 0,
  target_date   DATE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_subject ON goals (subject_id);

CREATE TABLE IF NOT EXISTS current_state_facts (
  id          SERIAL PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES intel_subjects (id),
  fact_key    TEXT NOT NULL,
  fact_value  TEXT NOT NULL,  -- cast by the reader per fact_key's known type; see ARCHITECTURE.md Gap 2
  fact_type   TEXT NOT NULL CHECK (fact_type IN ('user_provided', 'verified', 'computed', 'inferred')),
  source_note TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fact_type <> 'verified' OR source_note IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_current_state_facts_subject ON current_state_facts (subject_id, fact_key);

CREATE TABLE IF NOT EXISTS constraints (
  id                  SERIAL PRIMARY KEY,
  subject_id          INTEGER NOT NULL REFERENCES intel_subjects (id),
  goal_id             INTEGER REFERENCES goals (id),
  constraint_type     TEXT NOT NULL CHECK (constraint_type IN
                         ('financial', 'documentation', 'eligibility', 'timing', 'knowledge',
                          'legal_regulatory', 'credit', 'income', 'capacity', 'geographic',
                          'dependency', 'missing_prerequisite')),
  description         TEXT NOT NULL,
  is_resolved         BOOLEAN NOT NULL DEFAULT FALSE,
  blocks_transition_id INTEGER REFERENCES transitions (id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_constraints_subject ON constraints (subject_id, is_resolved);

CREATE TABLE IF NOT EXISTS recommendations (
  id                   SERIAL PRIMARY KEY,
  subject_id           INTEGER NOT NULL REFERENCES intel_subjects (id),
  goal_id              INTEGER NOT NULL REFERENCES goals (id),
  recommended_action   TEXT,  -- NULL is a legitimate outcome: "every known requirement is met, nothing to recommend"
  rationale            TEXT NOT NULL,
  based_on_facts       JSONB NOT NULL,
  based_on_constraints JSONB NOT NULL,
  missing_information  JSONB NOT NULL,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_goal ON recommendations (goal_id);

-- ============================================================
-- Opportunity Engine wiring — ARCHITECTURE.md §20 milestone
-- ============================================================
-- Connects the intelligence layer to the ALREADY-BUILT capability
-- registry (CAPABILITY_NETWORK.md) instead of forking a second
-- "opportunity" data model. A transition_requirements row MAY name the
-- capability that satisfies it; when the intelligence engine's chosen
-- (unmet) requirement carries that link, it re-uses
-- lib/capabilityGraph.js's already-tested getRoutingRecommendation() to
-- report real provider availability — never invented. Today that will
-- almost always mean "no provider available yet" honestly, because
-- network_providers is still empty; that is the correct, not a broken,
-- result.
ALTER TABLE transition_requirements ADD COLUMN IF NOT EXISTS capability_id INTEGER REFERENCES capabilities (id);
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS related_capability JSONB;

-- ============================================================
-- Recommendation purity + intentional persistence
-- ============================================================
-- ARCHITECTURE_REVIEW.md found that intelligenceEngine.js's
-- computeRecommendation() used to write a new `recommendations` row on
-- EVERY call, including from the public, unauthenticated
-- api/intelligence-demo.js endpoint — measured, real state pollution on
-- every page load (5 rows -> 7 from just 2 calls in that review's own
-- test run). Fixed by splitting "compute" (pure, no writes) from
-- "record" (the one place that persists — recordRecommendation()) and
-- deduplicating writes by a real state fingerprint over the fields that
-- define WHAT is recommended and why — the same discipline
-- lib/weatherModel.js's state_snapshots already use, reusing the same
-- stableStringify()+sha256 approach rather than inventing a third one.
-- NULL on rows written before this pass is expected and safe:
-- recordRecommendation() only ever dedupes against the MOST RECENT row
-- for a subject+goal, so a NULL-fingerprint legacy row simply never
-- matches, and the very next real write carries a real fingerprint.
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS state_fingerprint TEXT;
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS rule_version TEXT;

-- Names WHICH requirement_key was chosen, so a caller (e.g. a public UI
-- animating "many candidates -> one CHEW Move") can reliably highlight
-- the right one instead of guessing by matching recommended_action text
-- against based_on_facts. NULL when nothing was chosen (every
-- requirement met, or no transition/requirements at all).
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS chosen_requirement_key TEXT;

-- ============================================================
-- Action / Task tracking — ARCHITECTURE.md §20 milestone (Gap 7)
-- ============================================================
-- Closes decision-loop steps 8-9 (ARCHITECTURE.md §13): a subject can
-- now mark a recommended action complete, and that completion can
-- become a new current_state_facts row that the next
-- computeRecommendation() call will see.
--
-- The honesty decision this schema encodes (previously left as an open
-- question in ARCHITECTURE.md's Gap 7):
--   - For a `boolean_true` requirement, completing its action IS the
--     fact — e.g. "open a dedicated business bank account," once done,
--     directly means has_business_bank_account = true. Completion
--     auto-creates a `user_provided` fact (self-reported, same
--     epistemic weight as any other user_provided fact — NOT upgraded
--     to 'verified' just because it came through this flow).
--   - For a `gte` / `lte` / `eq` requirement (a threshold, e.g. "raise
--     your credit score toward 620"), completing the *activity* does
--     NOT tell CHEW the new value — doing the work is not the same as
--     knowing the resulting number. Never infer a threshold value from
--     activity completion. A caller MUST supply the subject's own
--     reported value (still `user_provided`, not upgraded to
--     'verified') to complete this kind of action — completion is
--     refused, not silently accepted with no fact, so the action stays
--     `pending` and can be retried with a real value instead of
--     reaching a dead end (an action can only be completed once).
-- lib/intelligenceEngine.js's completeAction() is the only code path
-- that writes resulting_fact_id — do not set it by hand.

CREATE TABLE IF NOT EXISTS actions (
  id                        SERIAL PRIMARY KEY,
  subject_id                INTEGER NOT NULL REFERENCES intel_subjects (id),
  goal_id                   INTEGER NOT NULL REFERENCES goals (id),
  transition_requirement_id INTEGER REFERENCES transition_requirements (id),
  recommendation_id         INTEGER REFERENCES recommendations (id),
  description               TEXT NOT NULL,  -- copied from action_if_unmet at creation time; immutable record of what was asked
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  resulting_fact_id         INTEGER REFERENCES current_state_facts (id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at              TIMESTAMPTZ,
  CHECK ((status = 'pending') = (completed_at IS NULL)),
  CHECK (resulting_fact_id IS NULL OR status = 'completed')
);

CREATE INDEX IF NOT EXISTS idx_actions_subject_status ON actions (subject_id, status);
CREATE INDEX IF NOT EXISTS idx_actions_goal ON actions (goal_id);

-- ============================================================
-- Scenario Modeling Foundation — CHEW Lab + Scenario Modeling
-- Foundation Master Directive
-- ============================================================
-- A durable Scenario is: a preserved baseline (what CHEW actually knew,
-- at read time, from the tables above) + a proposed move + explicit
-- assumptions + structured effects computed by re-running the exact
-- same deterministic requirement-chain rule (lib/intelligenceEngine.js
-- / scenario-engine.js) against a hypothetically changed fact, never a
-- second invented engine.
--
-- Identity boundary (the whole reason this table exists now instead of
-- waiting): subject_type is identity-READY (the enum already includes
-- 'member') but production member ownership is actively BLOCKED at the
-- database level by the second CHECK below, not merely documented —
-- no row can be inserted with subject_type = 'member' until a real
-- authenticated member identity layer exists (ARCHITECTURE.md Gap 1)
-- and that CHECK is deliberately relaxed. Until then every scenario's
-- subject_ref points at the one seeded intel_subjects row used
-- everywhere else on this site (see db/seed-intelligence.sql) — never
-- a fabricated per-visitor UUID pretending to be a member.
--
-- scenario_status folds "current vs. stale" into one field rather than
-- adding a second stale boolean next to it — see lib/scenarioModel.js's
-- staleness check, which flips this on read when the real baseline
-- facts have moved since capture, and never silently recomputes the
-- scenario's stored effects when it does.
CREATE TABLE IF NOT EXISTS scenarios (
  id                          SERIAL PRIMARY KEY,
  subject_type                TEXT NOT NULL CHECK (subject_type IN ('illustrative', 'member')),
  subject_ref                 INTEGER NOT NULL REFERENCES intel_subjects (id),
  goal_id                     INTEGER NOT NULL REFERENCES goals (id),
  title                       TEXT NOT NULL,
  description                 TEXT,
  baseline_snapshot           JSONB NOT NULL,   -- "what CHEW knew" at capture time — see lib/scenarioModel.js buildBaselineSnapshot()
  proposed_move               JSONB NOT NULL,   -- { type, requirementKey, description, comparisonGroupKey? }
  assumptions                 JSONB NOT NULL,   -- array of explicit assumption strings — never hidden
  time_horizon                TEXT NOT NULL CHECK (time_horizon IN
                                 ('immediate', '30_days', '90_days', '6_months', '12_months', 'custom')),
  effects                     JSONB NOT NULL,   -- array of structured effect objects — see lib/scenarioModel.js
  dependencies                JSONB NOT NULL,   -- the real ordered requirement chain this scenario was evaluated against
  affected_goals              JSONB NOT NULL,
  affected_constraints        JSONB NOT NULL,
  affected_opportunities      JSONB NOT NULL,
  risks                       JSONB NOT NULL,
  reversibility               TEXT NOT NULL CHECK (reversibility IN
                                 ('easily_reversible', 'moderately_reversible', 'difficult_to_reverse',
                                  'irreversible', 'unknown')),
  uncertainty_classification  TEXT NOT NULL CHECK (uncertainty_classification IN
                                 ('known', 'deterministic', 'assumption_dependent', 'estimated', 'unknown')),
  scenario_status             TEXT NOT NULL DEFAULT 'current' CHECK (scenario_status IN ('current', 'stale')),
  model_version                TEXT NOT NULL,
  rule_version                TEXT NOT NULL,
  baseline_computed_at        TIMESTAMPTZ NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Production member ownership is intentionally blocked until a real
  -- authenticated member identity layer exists — see comment above.
  -- Remove this CHECK (and only this one) when that layer ships.
  CHECK (subject_type <> 'member')
);

CREATE INDEX IF NOT EXISTS idx_scenarios_subject ON scenarios (subject_type, subject_ref, goal_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_status ON scenarios (scenario_status);

-- ============================================================
-- Multi-goal Conflict Detection — explicit, rule-backed only
-- ============================================================
-- The one hard rule this table exists to enforce: CHEW must never infer
-- that two goals conflict just because it "makes intuitive sense." A
-- row here is a human-authored declaration — like transition_requirements'
-- sequence_order or capability_id link — naming the exact real fact_key
-- both goals' reasoning depends on, and the real-world mechanism why.
-- lib/scenarioModel.js's cross-goal functions REFUSE to model an effect
-- between any two goals that don't have a row here; there is no
-- fallback path that lets a caller conjure a conflict on the fly.
--
-- Deliberately sparse by design (see FEATURE_FLAGS.md): this repo seeds
-- exactly one real conflict — the two existing illustrative goals share
-- a real dependence on the documented_income fact (both mortgage
-- underwriting and business funding-readiness care about verifiable,
-- consistent income) — rather than inventing a dozen plausible-sounding
-- ones with no real mechanism behind them.
CREATE TABLE IF NOT EXISTS goal_conflict_rules (
  id             SERIAL PRIMARY KEY,
  goal_a_id      INTEGER NOT NULL REFERENCES goals (id),
  goal_b_id      INTEGER NOT NULL REFERENCES goals (id),
  shared_fact_key TEXT NOT NULL,  -- the real fact_key at least one side's real requirement chain reads
  conflict_type  TEXT NOT NULL CHECK (conflict_type IN ('shared_fact', 'shared_resource', 'shared_time')),
  mechanism      TEXT NOT NULL,  -- human-authored explanation of why these goals actually compete
  certainty      TEXT NOT NULL CHECK (certainty IN ('known', 'deterministic', 'assumption_dependent', 'estimated', 'unknown')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (goal_a_id <> goal_b_id)
);

CREATE INDEX IF NOT EXISTS idx_goal_conflict_rules_pair ON goal_conflict_rules (goal_a_id, goal_b_id);

-- Cross-goal scenarios reuse the exact same scenarios table and the
-- exact same versioning/staleness/persistence code path as a single-goal
-- scenario — never a second, parallel persistence model. related_goal_id
-- and conflict_rule_id are both nullable specifically so every
-- single-goal scenario created before this addition, and every one
-- created after it, stays valid with both columns NULL.
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS related_goal_id INTEGER REFERENCES goals (id);
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS conflict_rule_id INTEGER REFERENCES goal_conflict_rules (id);

-- ============================================================
-- Hidden Leverage Foundation — evidence-only discovery, never
-- brainstormed. See lib/leverageModel.js.
-- ============================================================
-- A leverage item answers: "what already exists in the subject's real
-- data that could help a goal, but is underused or unconnected?" — the
-- opposite direction from Scenario Modeling (which starts from a
-- proposed change). Deliberately NOT built on the scenarios table: a
-- leverage item has no baseline/effects/proposed-move shape, because it
-- isn't modeling a hypothetical move — it's pointing at something real
-- that already exists. Forcing it into the Scenario shape would be
-- exactly the kind of "richness that isn't there" this feature must
-- avoid.
--
-- source_type is intentionally sparse. Only 'fact' has a real detector
-- as of this pass (lib/leverageModel.js's discoverMultiGoalFactLeverage).
-- 'capability' and 'conflict_rule' are listed because they are legitimate
-- future evidence sources this schema can already support without new
-- tables, not because they're implemented yet — see FEATURE_FLAGS.md.
--
-- verification_state reuses current_state_facts.fact_type's exact
-- vocabulary rather than inventing a parallel one: a leverage item
-- built on a 'user_provided' fact is only as trustworthy as that fact
-- already is everywhere else on this site.
--
-- uncertainty_classification adds 'editorial' to the vocabulary
-- scenarios.uncertainty_classification uses, per direct instruction —
-- a leverage item built on a declared-but-not-stored editorial mapping
-- (e.g. Wealth World's CAP_TERRITORIES-style grouping) must be
-- distinguishable from one built on a real stored rule. This is a
-- separate CHECK from scenarios' own, deliberately — Hidden Leverage is
-- not required to resemble Scenario Modeling's vocabulary exactly.
--
-- Identity boundary: identical pattern to scenarios — subject_type is
-- identity-ready ('member' is a legal enum value) but a second CHECK
-- actively blocks any row from using it until a real authenticated
-- member identity layer exists.
CREATE TABLE IF NOT EXISTS leverage_items (
  id                          SERIAL PRIMARY KEY,
  subject_type                TEXT NOT NULL CHECK (subject_type IN ('illustrative', 'member')),
  subject_ref                 INTEGER NOT NULL REFERENCES intel_subjects (id),
  source_type                 TEXT NOT NULL CHECK (source_type IN ('fact', 'capability', 'conflict_rule')),
  source_ref                  INTEGER NOT NULL,  -- id within the table source_type names (e.g. current_state_facts.id)
  leverage_category           TEXT NOT NULL CHECK (leverage_category IN
                                 ('reusable_requirement', 'multi_goal_fact', 'dormant_capability',
                                  'underused_resource', 'duplicate_effort_avoided')),
  title                       TEXT NOT NULL,
  description                 TEXT NOT NULL,
  related_goal_ids            JSONB NOT NULL,
  related_constraint_ids      JSONB NOT NULL,
  related_opportunity_ids     JSONB NOT NULL,
  related_capability_ids      JSONB NOT NULL,
  applicability_rule          TEXT NOT NULL,  -- human-readable statement of exactly which real rule/mapping justifies this item
  evidence                    JSONB NOT NULL,  -- structured pointers (fact id/key/value, requirement keys, conflict rule id) — never prose alone
  verification_state          TEXT NOT NULL CHECK (verification_state IN ('user_provided', 'verified', 'computed', 'inferred')),
  activation_status           TEXT NOT NULL DEFAULT 'discovered' CHECK (activation_status IN
                                 ('discovered', 'available', 'needs_verification', 'needs_action',
                                  'already_activated', 'unavailable', 'stale')),
  suggested_action            TEXT NOT NULL,
  expected_effect_type        TEXT NOT NULL CHECK (expected_effect_type IN
                                 ('supports_multiple_goals', 'reduces_duplicate_effort', 'unlocks_capability')),
  uncertainty_classification  TEXT NOT NULL CHECK (uncertainty_classification IN
                                 ('known', 'deterministic', 'assumption_dependent', 'editorial', 'unknown')),
  model_version                TEXT NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at            TIMESTAMPTZ,
  CHECK (subject_type <> 'member')
);

CREATE INDEX IF NOT EXISTS idx_leverage_items_subject ON leverage_items (subject_type, subject_ref);
CREATE INDEX IF NOT EXISTS idx_leverage_items_source ON leverage_items (source_type, source_ref);
CREATE INDEX IF NOT EXISTS idx_leverage_items_status ON leverage_items (activation_status);
-- Idempotent discovery: the same real evidence must never produce two
-- rows — lib/leverageModel.js's find-or-create logic relies on this
-- constraint existing, not just on its own care.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_leverage_items_evidence
  ON leverage_items (subject_ref, source_type, source_ref, leverage_category);

-- ============================================================
-- Capability Relevance Rules — the sole authorization point for
-- Dormant Capability detection
-- ============================================================
-- Same refusal discipline as goal_conflict_rules: lib/leverageModel.js's
-- Dormant Capability detector is only ever allowed to say a capability
-- is relevant to a goal/requirement/fact when a row here explicitly
-- declares it. There is no similarity heuristic, no category-name
-- matching, and no fallback — an unmatched goal/requirement/fact simply
-- has no dormant-capability candidate, full stop.
--
-- source_type/source_ref is deliberately polymorphic (no single FK,
-- same pattern as leverage_items.source_ref) because a real relevance
-- mapping can honestly exist at three different real granularities in
-- this schema: the goal itself (source_ref = goals.id), a specific
-- requirement (source_ref = transition_requirements.id), or a raw fact
-- (source_ref = current_state_facts.id — used only once a fact-level
-- mapping is actually authored). capability_id IS a real single-table
-- FK, since "which capability" is never ambiguous.
--
-- certainty reuses goal_conflict_rules' exact vocabulary (not
-- leverage_items' extended one) on purpose: a row here is always a
-- real, explicit, stored, intentionally-authored rule — never a loose
-- editorial grouping like Wealth World's CAP_TERRITORIES — so
-- 'editorial' does not apply here.
CREATE TABLE IF NOT EXISTS capability_relevance_rules (
  id                 SERIAL PRIMARY KEY,
  source_type        TEXT NOT NULL CHECK (source_type IN ('goal', 'requirement', 'fact')),
  source_ref         INTEGER NOT NULL,
  capability_id      INTEGER NOT NULL REFERENCES capabilities (id),
  relationship_type  TEXT NOT NULL CHECK (relationship_type IN
                        ('supports_goal_execution', 'fulfills_requirement', 'addresses_constraint')),
  mechanism          TEXT NOT NULL,  -- human-authored explanation of why this capability actually helps
  certainty          TEXT NOT NULL CHECK (certainty IN ('known', 'deterministic', 'assumption_dependent', 'estimated', 'unknown')),
  jurisdiction_id    INTEGER REFERENCES jurisdictions (id),  -- NULL = no jurisdiction-specific restriction
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  authored_by        TEXT NOT NULL,  -- real provenance statement — who/what authored this, and how
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capability_relevance_rules_source ON capability_relevance_rules (source_type, source_ref);
CREATE INDEX IF NOT EXISTS idx_capability_relevance_rules_capability ON capability_relevance_rules (capability_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_capability_relevance_rules
  ON capability_relevance_rules (source_type, source_ref, capability_id, relationship_type);

-- ============================================================
-- Economic Weather — historical-state foundation
-- ============================================================
-- A state_snapshots row preserves ONLY what lib/weatherModel.js can
-- actually calculate from real, already-tested reads (the same fields
-- lib/scenarioModel.js's buildBaselineSnapshot() already computes, plus
-- one real site-wide capability count) — never income, liquidity,
-- credit trend, employment stability, or asset trajectory, because none
-- of those exist anywhere in this schema. See lib/weatherModel.js's own
-- header for the full audit this table's column list is based on.
--
-- Deliberately NOT the same table as `scenarios`: a snapshot preserves
-- what CHEW actually observed, never a hypothetical modeled effect — see
-- lib/weatherModel.js for the explicit rule that snapshot capture never
-- reads from the scenarios table.
--
-- newly_unlocked_opportunity_count is deliberately NOT a column here —
-- "newly unlocked" is inherently a comparison between two snapshots, not
-- a fact true at a single point in time, so it is computed at
-- buildEconomicWeather() comparison time instead of stored redundantly.
--
-- Deduplication is enforced by lib/weatherModel.js's own logic (skip
-- persisting when the newly-computed fingerprint matches the most
-- recent snapshot for this subject+goal), not by a database UNIQUE
-- constraint on state_fingerprint — a fingerprint MAY legitimately repeat
-- much later if real state cycles back to a value it held before, and a
-- global uniqueness constraint would wrongly block that real, later
-- snapshot. The identity boundary below still holds regardless.
CREATE TABLE IF NOT EXISTS state_snapshots (
  id                             SERIAL PRIMARY KEY,
  subject_type                   TEXT NOT NULL CHECK (subject_type IN ('illustrative', 'member')),
  subject_ref                    INTEGER NOT NULL REFERENCES intel_subjects (id),
  goal_id                        INTEGER NOT NULL REFERENCES goals (id),
  observed_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_reason                TEXT NOT NULL CHECK (snapshot_reason IN
                                    ('initial_baseline', 'requirement_changed', 'barrier_resolved',
                                     'recommendation_changed', 'opportunity_unlocked',
                                     'capability_state_changed', 'scenario_recalculated',
                                     'manual_internal_snapshot')),
  readiness_numerator            INTEGER NOT NULL,
  readiness_denominator          INTEGER NOT NULL,
  resolved_requirement_count     INTEGER NOT NULL,
  unresolved_requirement_count   INTEGER NOT NULL,
  current_focus_requirement_key  TEXT,  -- NULL is a real, legitimate state: every requirement is met
  current_focus_action           TEXT,
  unresolved_constraint_count    INTEGER NOT NULL,  -- the real "active barrier" count
  linked_capability_count        INTEGER,  -- NULL when no requirement in this goal's chain links a capability at all
  active_opportunity_count       INTEGER,  -- NULL under the same condition as linked_capability_count — never a fabricated 0
  capability_availability_count  INTEGER NOT NULL,  -- real, site-wide: capabilities with >=1 active/ready provider right now
  capability_total_count         INTEGER NOT NULL,  -- real, site-wide: total capabilities in the registry
  state_fingerprint              TEXT NOT NULL,  -- sha256 over the fields above only — never observed_at or snapshot_reason
  raw_state_payload              JSONB NOT NULL,  -- full requirementState + capabilityCoverage detail, for inspection
  source_version                 TEXT NOT NULL,
  rule_version                   TEXT NOT NULL,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (subject_type <> 'member')
);

CREATE INDEX IF NOT EXISTS idx_state_snapshots_subject_goal ON state_snapshots (subject_ref, goal_id, observed_at DESC);

-- ============================================================
-- Opportunity-identity history (Economic Weather's opportunity-access signal)
-- ============================================================
-- active_opportunity_ids preserves the real, canonical persisted
-- identity of each currently active opportunity — a real
-- network_providers.id, never a title/index/fuzzy match — so a later
-- comparison can prove composition changed (the same COUNT of
-- opportunities, but different real ones) rather than only ever seeing
-- a number go up, down, or stay flat. Same null-vs-empty-array
-- discipline as active_opportunity_count/linked_capability_count above:
-- NULL means this goal's requirement chain links no capability at all
-- (no real pipeline exists to track — structurally unavailable); an
-- empty array [] means a real capability link exists but zero real
-- providers are active right now (a real, legitimate zero, not the
-- same as "no coverage"). See lib/capabilityGraph.js's
-- getActiveProviderIds() for the one real query this is sourced from.
--
-- newly_unlocked_opportunity_ids is deliberately NOT a column here, for
-- the identical reason newly_unlocked_opportunity_count was never one
-- (see this table's own comment above) — "newly unlocked" is a
-- comparison between two snapshots, computed at buildEconomicWeather()
-- time from two real active_opportunity_ids arrays, never stored
-- redundantly.
--
-- Included in state_fingerprint (see lib/weatherModel.js) — without
-- this, a real composition change with an unchanged COUNT would be
-- silently deduped as "identical state" and never captured as a new
-- snapshot at all, defeating the entire point of this column.
ALTER TABLE state_snapshots ADD COLUMN IF NOT EXISTS active_opportunity_ids JSONB;

-- active_opportunity_link_type discloses WHICH real relationship an
-- observation's opportunity identity is actually sourced from — never
-- blurred into one generic "linked" bucket. 'requirement' = a direct
-- transition_requirements.capability_id link on this goal's own real
-- requirement chain (the original, more specific relationship).
-- 'goal_relevance' = a real capability_relevance_rules row at the goal
-- level (a human-authored "this capability helps execute this
-- transaction" relationship, not a requirement-level match) — the
-- second real pipeline this schema supports, first exercised for the
-- home goal's real real_asset_execution rule. NULL alongside a NULL
-- active_opportunity_ids means neither real relationship exists for
-- this goal. Included in state_fingerprint for the same reason
-- active_opportunity_ids is — a goal gaining a MORE specific
-- relationship (requirement replacing goal_relevance) is itself a real,
-- material state change worth its own snapshot.
ALTER TABLE state_snapshots ADD COLUMN IF NOT EXISTS active_opportunity_link_type TEXT
  CHECK (active_opportunity_link_type IS NULL OR active_opportunity_link_type IN ('requirement', 'goal_relevance'));

-- ============================================================
-- Complaint Intelligence — foundation only
-- ============================================================
-- Smallest clean architecture for categorizing member complaints/support
-- issues consistently, per the CHEW Shield no-drift directive. No public
-- submission form is wired to this table yet — contact.html's mailto:
-- link remains the actual current intake path. This exists so a future
-- intake surface (or manual admin logging of an email complaint) has a
-- real schema to land in, rather than being invented ad hoc later.
-- application_id is nullable because not every complaint originates from
-- someone with an application on file.
CREATE TABLE IF NOT EXISTS complaints (
  id              SERIAL PRIMARY KEY,
  application_id  INTEGER REFERENCES applications (id),
  email           TEXT,
  category        TEXT NOT NULL CHECK (category IN (
                    'billing_confusion', 'expectation_mismatch', 'service_delay',
                    'access_issue', 'data_concern', 'privacy_concern',
                    'product_malfunction', 'refund_request',
                    'credit_intelligence_concern', 'third_party_issue',
                    'communication_issue', 'other'
                  )),
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'closed')),
  resolution_note TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints (status);
CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints (category);

-- Admissions operations flow: the admin UI previously had one ambiguous
-- decision_note textarea that was BOTH stored AND emailed to the applicant
-- verbatim. That's now two explicitly separate fields:
--   internal_note      -- CHEW-only operator note. NEVER emailed.
--   applicant_message  -- optional message that MAY appear in the
--                         applicant's decision email.
-- Additive only. decision_note itself is left exactly as it was --
-- untouched, not renamed, not dropped -- because historically it WAS the
-- text emailed to the applicant, so reinterpreting it as "internal" would
-- silently misrepresent old applicant-facing text as private operator
-- notes. Existing decision/status/access_token fields are untouched.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS internal_note TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_message TEXT;

-- One-time, idempotent backfill: any application already decided under the
-- old single-field behavior had its decision_note text emailed out, so
-- that history belongs in applicant_message -- never in internal_note.
-- Only touches rows where applicant_message is still unset, so re-running
-- this file (its own established convention -- see IF NOT EXISTS above) is
-- always safe.
UPDATE applications
SET applicant_message = decision_note
WHERE decision_note IS NOT NULL
  AND applicant_message IS NULL;

-- booking-confirmed.html (api/booking-confirmation.js) looks up a purchase
-- by Stripe Checkout Session id on every payment redirect, and re-checks
-- it repeatedly while polling for the webhook to land -- a new, frequent
-- read pattern on a column that had no index before.
CREATE INDEX IF NOT EXISTS idx_program_purchases_entry_session ON program_purchases (entry_stripe_session_id);

-- Webhook notification durability: entry_paid_at is authoritative PAYMENT
-- state. It is NOT a safe proxy for whether the enrollment emails actually
-- sent -- a prior version gated both on the same claim, so a payment that
-- confirmed successfully but hit an email-provider failure right after
-- would never get its notification retried (entry_paid_at was already
-- set, so the retry skipped the whole branch, emails included). These two
-- columns are separate, independently-tracked facts: payment confirmed,
-- and each notification actually sent. Additive only -- entry_paid_at and
-- every other existing column are untouched.
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS customer_enrollment_notified_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS owner_enrollment_notified_at TIMESTAMPTZ;

-- Same doctrine, applied to the remainder-balance payment. Audited first:
-- create-remainder-checkout-session.js refuses to create a second Stripe
-- session once remainder_paid_at is set OR once status has left
-- 'pending_remainder' -- there is no installment/multi-payment concept
-- anywhere in this schema, remainder is architecturally a single final
-- balance payment per purchase. That makes a purchase-level timestamp
-- (not a per-payment-event key) the correct, smallest-fit design here --
-- the same shape as the entry-phase columns above, not a heavier
-- per-event ledger this data model doesn't need.
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS remainder_customer_notified_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS remainder_owner_notified_at TIMESTAMPTZ;

-- Contract Excellence pass: strengthens signature evidence and closes the
-- commercial-term-drift gap found while auditing the checkout flow.
--
-- agreement_read_and_accepted -- the affirmative "I agree" checkbox was
-- previously enforced only client-side (HTML `required`); api/sign-
-- agreement.js now requires and stores it as a real fact, not an assumed
-- one. NOT NULL with no default so it's impossible to insert a row
-- without an explicit true/false (the API always sends one).
--
-- agreement_content_hash -- a SHA-256 of the exact rendered agreement
-- text (lib/agreementText.js) for the signed tier, computed server-side
-- at signature time. agreement_version is a label a future edit could
-- forget to bump; this hash is deterministic proof of the literal text a
-- given signature was shown, independent of version-bump discipline.
--
-- *_at_signing -- a snapshot of the real commercial terms (from
-- lib/programs.js) at the moment of signature, so checkout can later
-- verify nothing changed between signing and paying. See
-- api/create-program-checkout-session.js: if live terms no longer match
-- this snapshot, checkout is refused and a fresh signature is required --
-- a client is never charged against terms they didn't actually see.
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS agreement_read_and_accepted BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS agreement_content_hash TEXT;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS entry_amount_cents_at_signing INTEGER;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS full_fee_cents_at_signing INTEGER;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS remainder_amount_cents_at_signing INTEGER;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS recurring_amount_cents_at_signing INTEGER;

-- Immediate signed-agreement delivery (owner + client), with the same
-- payment/notification-state separation doctrine already proven for
-- Stripe webhook durability.
--
-- agreement_snapshot_html -- the exact rendered agreement text (from
-- lib/agreementText.js) captured at signing time. agreement_content_hash
-- (above) proves a text hasn't silently changed, but proving it isn't the
-- same as being ABLE to reproduce it — lib/agreementText.js only holds
-- the CURRENT version's text, so a future amendment would leave older
-- signatures with a hash but nothing left to check it against. Storing
-- the actual text makes every signature genuinely, permanently
-- reproducible regardless of later edits — the real "immutable copy,"
-- not merely tamper-evidence.
--
-- owner_agreement_notified_at / client_agreement_notified_at -- durable,
-- independent notification-sent facts, same shape as the Stripe webhook's
-- customer/owner notified_at columns: signing itself (durable the moment
-- the row commits) is a different fact from either email actually being
-- delivered, and each recipient's notification is claimed and retried
-- independently of the other.
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS agreement_snapshot_html TEXT;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS owner_agreement_notified_at TIMESTAMPTZ;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS client_agreement_notified_at TIMESTAMPTZ;

-- Approved commercial architecture: 5 engagement classes (was 3), and every
-- one-time engagement now offers Pay in Full or a finite Monthly Plan
-- (initial payment + N automatic installments via a Stripe Subscription
-- Schedule) instead of the old "entry fee now, remainder whenever you're
-- ready" model. Widening the tier CHECK constraints is additive (no rows
-- are rewritten); dropping and re-adding by the standard Postgres
-- auto-generated constraint name is safe to re-run.
ALTER TABLE program_purchases DROP CONSTRAINT IF EXISTS program_purchases_tier_check;
ALTER TABLE program_purchases ADD CONSTRAINT program_purchases_tier_check
  CHECK (tier IN ('focused_builder', 'infrastructure', 'advanced_infrastructure', 'executive', 'membership'));
ALTER TABLE agreement_signatures DROP CONSTRAINT IF EXISTS agreement_signatures_tier_check;
ALTER TABLE agreement_signatures ADD CONSTRAINT agreement_signatures_tier_check
  CHECK (tier IN ('focused_builder', 'infrastructure', 'advanced_infrastructure', 'executive', 'membership'));

-- The plan_payment webhook branch (api/stripe-webhook.js) sets
-- program_purchases.status = 'active' once a one-time engagement's first
-- payment confirms — a status the original CHECK never allowed, which
-- would otherwise make that UPDATE fail in production. Widened the same
-- additive way as the tier constraints above.
ALTER TABLE program_purchases DROP CONSTRAINT IF EXISTS program_purchases_status_check;
ALTER TABLE program_purchases ADD CONSTRAINT program_purchases_status_check
  CHECK (status IN ('pending_entry', 'pending_remainder', 'complete', 'active'));

-- Payment-plan snapshot at signing time (mirrors the existing
-- entry/full-fee/remainder/recurring *_at_signing columns' purpose: prove
-- what commercial terms — including which payment option — the client
-- actually saw and agreed to, so checkout can refuse to proceed if live
-- terms have since drifted).
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS payment_plan_type_at_signing TEXT CHECK (payment_plan_type_at_signing IN ('pay_in_full', 'monthly'));
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS total_contract_amount_at_signing INTEGER;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS initial_payment_amount_at_signing INTEGER;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS installment_amount_at_signing INTEGER;
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS installment_count_at_signing INTEGER;

-- New payment-plan state on program_purchases, additive alongside (not
-- replacing) the existing entry_amount_cents/remainder_* columns, which
-- stay exactly as they are for the prior entry+remainder model. New
-- one-time purchases use the columns below instead; payment_plan_type
-- being non-null is what distinguishes a "new model" purchase row from a
-- legacy one in application code (api/stripe-webhook.js).
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS payment_plan_type TEXT CHECK (payment_plan_type IN ('pay_in_full', 'monthly'));
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS total_contract_amount_cents INTEGER;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS initial_payment_amount_cents INTEGER;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS installment_amount_cents INTEGER;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS installment_count INTEGER;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS installments_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS stripe_subscription_schedule_id TEXT;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS initial_payment_paid_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS next_payment_due_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS paid_in_full_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS payment_plan_status TEXT
  CHECK (payment_plan_status IN ('current', 'payment_failed', 'retrying', 'past_due', 'paused', 'cured', 'paid_in_full', 'cancelled'));

-- Durable, independently-claimed notification facts for the new payment
-- model, same doctrine as every other notified_at column in this schema:
-- payment truth (initial_payment_paid_at, installments_paid) and
-- notification-sent truth are separate facts, so an email failure never
-- blocks payment recognition and a Stripe retry never double-sends.
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS initial_payment_customer_notified_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS initial_payment_owner_notified_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS payment_failed_customer_notified_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS payment_failed_owner_notified_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS paid_in_full_customer_notified_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS paid_in_full_owner_notified_at TIMESTAMPTZ;

-- One installment invoice must never be recorded or notified about twice
-- even if Stripe redelivers invoice.payment_succeeded — the same
-- idempotency role entry_stripe_session_id already plays for the entry
-- payment, keyed by Stripe's own invoice id this time since a payment
-- plan has many invoices, not one session.
CREATE TABLE IF NOT EXISTS program_purchase_installments (
  id                    SERIAL PRIMARY KEY,
  purchase_id           INTEGER NOT NULL REFERENCES program_purchases (id),
  stripe_invoice_id     TEXT UNIQUE NOT NULL,
  amount_cents          INTEGER NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('paid', 'failed')),
  customer_notified_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_program_purchase_installments_purchase ON program_purchase_installments (purchase_id);

-- ============================================================
-- CHEW Recommendation Engine
-- ============================================================
-- Separates three previously-collapsed decisions: (A) admissions
-- (applications.decision, unchanged), (B) scope — what engagement level
-- an accepted applicant's position actually requires, decided by a human
-- CHEW admin and recorded here, and (C) the client's own purchase choice
-- among ONLY the options CHEW approved (engagement_selections below).
-- Prior to this, api/sign-agreement.js and api/create-program-checkout-
-- session.js accepted ANY of the four one-time tiers from ANY accepted
-- applicant with no approval record to check against — this is the
-- schema that makes "approved" a real, checkable fact for the first time.
--
-- Versioned and separate from `applications` (not bolted-on columns) so
-- CHEW can revise a recommendation later while preserving exactly what
-- the client actually saw and signed against at the time — the same
-- evidence-preservation doctrine already used for agreement_signatures'
-- *_at_signing snapshot columns.

CREATE TABLE IF NOT EXISTS engagement_recommendations (
  id                     SERIAL PRIMARY KEY,
  application_id         INTEGER NOT NULL REFERENCES applications (id),
  version                INTEGER NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'sent', 'superseded', 'withdrawn')),
  primary_tier           TEXT NOT NULL
                           CHECK (primary_tier IN ('focused_builder', 'infrastructure', 'advanced_infrastructure', 'executive')),
  alternative_tier       TEXT
                           CHECK (alternative_tier IN ('focused_builder', 'infrastructure', 'advanced_infrastructure', 'executive')),
  -- A lower-scope alternative is a narrower starting point, never a
  -- discount on the same scope — enforced structurally, not just by
  -- convention: an alternative_tier cannot exist without a human-
  -- approved explanation of what it does and doesn't include.
  focus_areas            JSONB NOT NULL DEFAULT '[]',
  client_facing_reason   TEXT NOT NULL,
  client_facing_summary  TEXT,
  alternative_tradeoff   TEXT,
  created_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at                TIMESTAMPTZ,
  viewed_at              TIMESTAMPTZ,
  superseded_at          TIMESTAMPTZ,
  scope_review_requested_at TIMESTAMPTZ,
  scope_review_message   TEXT,
  CHECK (alternative_tier IS NULL OR alternative_tier <> primary_tier),
  CHECK (alternative_tier IS NULL OR alternative_tradeoff IS NOT NULL),
  UNIQUE (application_id, version)
);
CREATE INDEX IF NOT EXISTS idx_engagement_recommendations_application ON engagement_recommendations (application_id);
-- "Only one non-superseded SENT recommendation may be active for an
-- application at one time" and "one editable draft in flight at a time" —
-- both enforced at the database level, not merely by application code
-- discipline, via partial unique indexes (same technique idx_active_slot
-- already uses on bookings elsewhere in this file).
CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_recommendations_one_sent
  ON engagement_recommendations (application_id) WHERE status = 'sent';
CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_recommendations_one_draft
  ON engagement_recommendations (application_id) WHERE status = 'draft';

-- Conditions live on the recommendation, not on `applications` — a
-- recommendation may carry zero, one, or several. Once a recommendation
-- is SENT, condition_text and blocking are treated as immutable
-- historical fact by every API that touches this table (no endpoint ever
-- accepts an update to either field) — only `satisfied`/`satisfied_at`/
-- `satisfied_by` ever change post-send. A substantive change to wording
-- or blocking classification requires a new recommendation version.
CREATE TABLE IF NOT EXISTS recommendation_conditions (
  id                SERIAL PRIMARY KEY,
  recommendation_id INTEGER NOT NULL REFERENCES engagement_recommendations (id),
  condition_text    TEXT NOT NULL,
  blocking          BOOLEAN NOT NULL DEFAULT TRUE,
  satisfied         BOOLEAN NOT NULL DEFAULT FALSE,
  satisfied_at      TIMESTAMPTZ,
  satisfied_by      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recommendation_conditions_recommendation ON recommendation_conditions (recommendation_id);

-- The client's own purchase-decision evidence, deliberately separate from
-- the recommendation (CHEW's evidence) and from agreement_signatures (the
-- binding commercial record) — this table exists only to distinguish
-- "recommendation viewed" from "engagement selected" from "payment option
-- selected" from "agreement signed" as honestly different, separately
-- timestamped facts, per the directive's explicit instruction not to
-- collapse them.
CREATE TABLE IF NOT EXISTS engagement_selections (
  id                        SERIAL PRIMARY KEY,
  application_id            INTEGER NOT NULL REFERENCES applications (id),
  recommendation_id         INTEGER NOT NULL REFERENCES engagement_recommendations (id),
  recommendation_version    INTEGER NOT NULL,
  selected_tier             TEXT NOT NULL
                              CHECK (selected_tier IN ('focused_builder', 'infrastructure', 'advanced_infrastructure', 'executive')),
  selected_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  selected_payment_plan     TEXT CHECK (selected_payment_plan IN ('pay_in_full', 'monthly')),
  payment_plan_selected_at  TIMESTAMPTZ,
  superseded_at             TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagement_selections_application ON engagement_selections (application_id);
CREATE INDEX IF NOT EXISTS idx_engagement_selections_recommendation ON engagement_selections (recommendation_id);
-- "One current active pre-signature selection per active recommendation."
CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_selections_one_active
  ON engagement_selections (recommendation_id) WHERE superseded_at IS NULL;

-- Binds the commercial record to the specific recommendation version the
-- client actually saw and was approved against. Nullable — historical
-- signatures signed before this migration have no recommendation and
-- remain valid; application code (api/sign-agreement.js) requires this
-- binding for every NEW signature going forward.
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS recommendation_id INTEGER REFERENCES engagement_recommendations (id);
ALTER TABLE agreement_signatures ADD COLUMN IF NOT EXISTS recommendation_version INTEGER;

-- Follow-up reminder claim columns — same doctrine as every other
-- *_reminder_sent/*_notified_at column in this schema: a durable,
-- claim-once fact so a cron re-run never double-sends. One column per
-- distinct follow-up nudge (see api/send-recommendation-reminders.js):
-- recommendation sent but not viewed, viewed but no engagement selected,
-- engagement selected but not yet signed. No fake urgency/countdown is
-- ever computed from these — they only gate a single honest reminder.
ALTER TABLE engagement_recommendations ADD COLUMN IF NOT EXISTS not_viewed_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE engagement_recommendations ADD COLUMN IF NOT EXISTS no_selection_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE engagement_recommendations ADD COLUMN IF NOT EXISTS not_signed_reminder_sent_at TIMESTAMPTZ;

-- "Recommendation Is Ready" email delivery, split from the sent_at DB
-- fact per the same claim-before-send doctrine used for payment emails
-- (see claimAndSendNotification in api/stripe-webhook.js): sent_at
-- records that CHEW approved and committed the recommendation;
-- client_recommendation_notified_at records that the email actually went
-- out. A Resend failure leaves this NULL without touching sent_at or
-- creating a new version, so api/save-recommendation.js's claim helper
-- can safely retry the notification alone on a later call.
ALTER TABLE engagement_recommendations ADD COLUMN IF NOT EXISTS client_recommendation_notified_at TIMESTAMPTZ;

-- 1-5 short, client-facing "what needs to happen" priority strings set by
-- the admin in the Scope Builder — distinct from recommendation_conditions
-- (which can individually be marked satisfied/blocking); priorities are
-- plain descriptive text with no per-item state, immutable once sent like
-- every other piece of sent recommendation content (a new version is
-- required to change them — see api/save-recommendation.js).
ALTER TABLE engagement_recommendations ADD COLUMN IF NOT EXISTS recommended_priorities JSONB;

-- Scope-review request note ("owner notified a client asked for another
-- look") split from the request fact (scope_review_requested_at, set
-- above) by the same doctrine: a Resend failure while notifying CHEW must
-- never lose the client's already-persisted request, and a retry must
-- never re-notify for the same request.
ALTER TABLE engagement_recommendations ADD COLUMN IF NOT EXISTS scope_review_owner_notified_at TIMESTAMPTZ;

-- ============================================================
-- Pre-Portal lifecycle closure: service completion, Continuity, and the
-- portal-invitation handoff (see PRE_PORTAL_MASTER_SPECIFICATION.html).
-- ============================================================

-- service_completed_at is a deliberate, one-way admin action (never
-- inferred from session/document-review counts, never automatic) --
-- locked decision: no undo endpoint exists, a genuine correction is an
-- exceptional direct-database operator action, not a routine workflow.
-- continuity_ends_at is computed ONCE at completion time (service_completed_at
-- + 30 days) and stored rather than recomputed on read, so it survives
-- even if a tier's terms change later. Continuity's end is a quiet,
-- non-eventful state transition per locked decision -- nothing reads
-- continuity_ends_at to gate anything client-facing; it exists purely as
-- a durable record of when the free window was.
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS service_completed_at TIMESTAMPTZ;
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS continuity_ends_at TIMESTAMPTZ;

-- portal_invited_at is the claim-before-send column for moving the
-- portal invitation off admissions-acceptance and onto confirmed
-- enrollment (see api/stripe-webhook.js). Lives on applications, NOT
-- program_purchases: an application can accumulate more than one
-- purchase over its lifetime (an original engagement, later Membership),
-- and the portal invitation is a once-ever-per-client fact, not a
-- once-per-purchase one -- a graduate buying Membership already has
-- portal access from their original engagement and must never be
-- re-invited.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS portal_invited_at TIMESTAMPTZ;
-- Separate from service_completed_at itself, same doctrine as every other
-- fact/notification split in this schema: the completion + Continuity
-- window are authoritative the instant service_completed_at is set,
-- regardless of whether the client's notice email actually goes out.
ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS continuity_notice_customer_notified_at TIMESTAMPTZ;

-- Execution ledgers -- one row per real, dated event, same convention as
-- program_purchase_installments above. Deliberately NOT a bare counter:
-- "sessions_delivered"/"document_reviews_used" are always COUNT(*) reads
-- against these tables, never a separately-stored number that could drift
-- from the actual event history (locked decision: the database records
-- reality, counts are derived).
CREATE TABLE IF NOT EXISTS program_purchase_sessions (
  id            SERIAL PRIMARY KEY,
  purchase_id   INTEGER NOT NULL REFERENCES program_purchases (id),
  session_number INTEGER NOT NULL,
  delivered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  logged_by     TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, session_number)
);
CREATE INDEX IF NOT EXISTS idx_program_purchase_sessions_purchase ON program_purchase_sessions (purchase_id);

CREATE TABLE IF NOT EXISTS program_purchase_document_reviews (
  id                 SERIAL PRIMARY KEY,
  purchase_id        INTEGER NOT NULL REFERENCES program_purchases (id),
  review_number      INTEGER NOT NULL,
  reviewed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  logged_by          TEXT,
  documents_reviewed TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, review_number)
);
CREATE INDEX IF NOT EXISTS idx_program_purchase_document_reviews_purchase ON program_purchase_document_reviews (purchase_id);

-- ============================================================
-- Canonical Graduate predicate (see lib/graduateStatus.js). Per external
-- review after the Pre-Portal implementation pass: "graduate" must have
-- ONE authoritative definition enforced at the database level, not
-- re-derived independently in every caller -- a future endpoint could
-- otherwise interpret "completed" as status = 'complete', or
-- payment_status = 'paid', instead of the actual locked doctrine
-- (service_completed_at IS NOT NULL, any qualifying engagement, ever).
-- Every call site -- Membership access, the entry-fee waiver,
-- my-engagement.html eligibility, the admin badge, and the eventual
-- Portal entitlement -- goes through this function (directly in SQL, or
-- via lib/graduateStatus.js's isGraduate() in application code) instead
-- of writing its own EXISTS(...) copy.
CREATE OR REPLACE FUNCTION is_graduate(p_application_id INTEGER) RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM program_purchases
    WHERE application_id = p_application_id AND service_completed_at IS NOT NULL
  );
$$ LANGUAGE sql STABLE;
