-- CHEW Feature Flags — initial state
--
-- path_engine and capability_network are 'preview' (not 'live') because
-- that's an honest description of what's actually shipped: one Florida
-- LLC path, a capability taxonomy with zero providers. Neither has a
-- public teaser card — each already has its own honestly-scoped link
-- elsewhere on the homepage, so a generic "Coming Soon"/"Explore" card
-- would either duplicate or understate that existing, more specific
-- copy. public_teaser_enabled stays FALSE for both.
--
-- The four "What's Next" capabilities are 'locked' (real API access is
-- 404) but 'public_teaser_enabled = TRUE' — they're meant to be seen as
-- honestly in-progress, matching the doctrine's own card copy.

INSERT INTO feature_flags (slug, name, status, public_teaser_enabled, public_title, public_description, category, release_note) VALUES
  ('path_engine', 'Business Path Engine (Florida LLC early preview)', 'preview', FALSE, NULL, NULL, 'business',
   'Covers exactly one path: Florida LLC formation + federal EIN. See PATH_ENGINE.md.'),
  ('capability_network', 'Capability Network routing', 'preview', FALSE, NULL, NULL, 'network',
   'Taxonomy + routing engine live; zero providers seeded yet. See CAPABILITY_NETWORK.md.'),
  ('business_intelligence_suite', 'Business Intelligence', 'locked', TRUE,
   'Business Intelligence', 'Build, structure, launch, operate, and grow.', 'business', NULL),
  ('education_careers', 'Education & Careers', 'locked', TRUE,
   'Education & Careers', 'From GED to credentials, college, careers, and opportunity paths.', 'education', NULL),
  ('asset_intelligence', 'Asset Intelligence', 'locked', TRUE,
   'Asset Intelligence', 'Understand what you own and how it may fit into your larger strategy.', 'assets', NULL),
  ('chew_connections_suite', 'CHEW Connections', 'locked', TRUE,
   'CHEW Connections', 'Access specialized capabilities when your plan calls for them.', 'network', NULL),
  ('intelligence_engine', 'CHEW Intelligence System (MVP recommendation slice)', 'internal', FALSE, NULL, NULL, 'intelligence',
   'No real subject/user identity behind this yet (ARCHITECTURE.md Gap 1). Internal/test use only until that exists — do not flip to preview/beta/live without real identity in place first.')
ON CONFLICT (slug) DO NOTHING;
