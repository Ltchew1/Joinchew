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
