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
