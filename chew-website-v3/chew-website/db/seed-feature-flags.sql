-- CHEW Feature Flags — initial state
--
-- path_engine and capability_network are set 'active' because that
-- narrow scope (one Florida LLC path; a capability taxonomy with zero
-- providers) was already built, tested end-to-end against a live
-- database, and shipped as an honestly-labeled early preview in prior
-- work. Everything else here is a full-suite marketing tease with no
-- backend behind it yet, so it stays 'coming_soon' — the API layer for
-- these doesn't exist, and none should be built to imply otherwise
-- until a real launch decision is made.

INSERT INTO feature_flags (slug, name, status, release_note) VALUES
  ('path_engine', 'Business Path Engine (Florida LLC early preview)', 'active',
   'Covers exactly one path: Florida LLC formation + federal EIN. See PATH_ENGINE.md.'),
  ('capability_network', 'Capability Network routing', 'active',
   'Taxonomy + routing engine live; zero providers seeded yet. See CAPABILITY_NETWORK.md.'),
  ('business_intelligence_suite', 'Business Intelligence', 'coming_soon', NULL),
  ('education_careers', 'Education & Careers', 'coming_soon', NULL),
  ('asset_intelligence', 'Asset Intelligence', 'coming_soon', NULL),
  ('chew_connections_suite', 'CHEW Connections', 'coming_soon', NULL)
ON CONFLICT (slug) DO NOTHING;
