-- CHEW Path Engine — seed data
-- Run this once, after schema.sql, to add the ONLY two verified path
-- requirements that exist as of this migration.
--
-- HOW THIS WAS VERIFIED: researched via web search (multiple independent
-- secondary sources citing the primary agency) on 2026-08-25. Direct fetch
-- of irs.gov and dos.fl.gov was blocked by the network egress policy in the
-- environment this was built in, so these are marked 'manually_verified'
-- rather than 'verified' — verification_status is deliberately NOT set to
-- 'verified', since that status should be reserved for a fact confirmed by
-- a direct, current pull against the primary source itself. Before this
-- goes in front of a real user, re-confirm both figures with a direct hit
-- against irs.gov and dos.fl.gov (or an automated fetch job that can reach
-- them) and update last_verified_at accordingly.
--
-- Every other business type / jurisdiction / requirement in the system is
-- intentionally absent. Do not add rows here that weren't independently
-- confirmed against a real source — see PATH_ENGINE.md.

INSERT INTO jurisdictions (country, state, county, city, label) VALUES
  ('US', NULL, NULL, NULL, 'United States (Federal)'),
  ('US', 'FL', NULL, NULL, 'Florida')
ON CONFLICT (country, state, county, city) DO NOTHING;

INSERT INTO sources (name, authority_level, url, jurisdiction_id, notes) VALUES
  (
    'Internal Revenue Service (IRS)',
    'A',
    'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online',
    NULL,
    'EIN application is free and, for online applicants, processed immediately during the session.'
  ),
  (
    'Florida Department of State, Division of Corporations (Sunbiz)',
    'A',
    'https://dos.fl.gov/sunbiz/start-business/efile/fl-llc/',
    (SELECT id FROM jurisdictions WHERE state = 'FL' AND county IS NULL AND city IS NULL),
    'Filing fee confirmed via multiple independent sources citing Sunbiz; direct fetch of dos.fl.gov blocked from the build environment at time of verification.'
  );

INSERT INTO business_types (slug, name, category, description) VALUES
  (
    'llc-formation',
    'Form an LLC (General)',
    'general_formation',
    'The baseline entity-formation and federal tax-ID steps that apply to most new businesses, regardless of industry. Industry-specific licensing is not included here — see PATH_ENGINE.md for coverage.'
  )
ON CONFLICT (slug) DO NOTHING;

-- Step 1: Articles of Organization (Florida LLC)
INSERT INTO path_requirements (
  business_type_id, jurisdiction_id, name, requirement_type, issuing_authority,
  source_id, cost_cents, cost_notes, renewal_period, sequence_order,
  documents_needed, official_action_url, notes, verification_status, last_verified_at
) VALUES (
  (SELECT id FROM business_types WHERE slug = 'llc-formation'),
  (SELECT id FROM jurisdictions WHERE state = 'FL' AND county IS NULL AND city IS NULL),
  'Articles of Organization (Florida LLC)',
  'required',
  'Florida Department of State, Division of Corporations',
  (SELECT id FROM sources WHERE name = 'Florida Department of State, Division of Corporations (Sunbiz)'),
  12500,
  '$100 Articles of Organization filing fee plus $25 registered agent designation fee. Optional: $30 for a certified copy, $5 for a certificate of status.',
  'Annual Report required each year to keep the LLC active (separate fee, not included here)',
  1,
  '["Legal business name (checked for availability on Sunbiz)", "Registered agent name and Florida street address", "Principal business address"]'::jsonb,
  'https://dos.fl.gov/sunbiz/start-business/efile/fl-llc/',
  'Filed online through the Sunbiz portal.',
  'manually_verified',
  '2026-08-25'
);

-- Step 2: EIN — depends on the entity existing (Step 1)
INSERT INTO path_requirements (
  business_type_id, jurisdiction_id, name, requirement_type, issuing_authority,
  source_id, cost_cents, cost_notes, renewal_period, sequence_order, depends_on_id,
  documents_needed, official_action_url, notes, verification_status, last_verified_at
) VALUES (
  (SELECT id FROM business_types WHERE slug = 'llc-formation'),
  (SELECT id FROM jurisdictions WHERE country = 'US' AND state IS NULL AND county IS NULL AND city IS NULL),
  'Employer Identification Number (EIN)',
  'required',
  'Internal Revenue Service',
  (SELECT id FROM sources WHERE name = 'Internal Revenue Service (IRS)'),
  0,
  'Free directly through the IRS. Any site that charges a fee for this is not the IRS.',
  NULL,
  2,
  (SELECT id FROM path_requirements WHERE name = 'Articles of Organization (Florida LLC)'),
  '["Responsible party''s SSN or ITIN", "Legal business name and formation date"]'::jsonb,
  'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online',
  'Online application is available Monday-Friday, 7am-10pm ET, and must be completed in one session — it expires after 15 minutes of inactivity.',
  'manually_verified',
  '2026-08-25'
);
