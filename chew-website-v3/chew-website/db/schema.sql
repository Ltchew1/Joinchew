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
