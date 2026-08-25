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
-- CHEW Feature Flags — server-side production-access gate
-- ============================================================
-- "Hidden UI is not security." Any not-yet-launched feature must be
-- unreachable at the API layer, not merely unlinked from navigation.
-- lib/featureFlags.js is the only supported way to read these — API
-- handlers call isFeatureActive(slug) and return 404 when false, so a
-- disabled feature is genuinely unreachable, not just hard to find.
--
-- status meanings:
--   locked       — not yet built for production use / explicitly held back
--   coming_soon  — publicly teased (e.g. a locked card), but the API
--                  behind it still 404s until flipped to 'active'
--   active       — really live; the API serves real requests
--
-- Flipping a row to 'active' is a real launch decision — do not change
-- a flag's status without being told to, and never seed a flag as
-- 'active' for a feature that hasn't actually been verified working.

CREATE TABLE IF NOT EXISTS feature_flags (
  id           SERIAL PRIMARY KEY,
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'coming_soon', 'active')),
  release_note TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
