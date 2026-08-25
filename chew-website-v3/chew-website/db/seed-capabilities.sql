-- CHEW Capability Network — capability taxonomy seed
--
-- This seeds ONLY the `capabilities` table: generic category labels
-- ("insurance / risk review", "digital business infrastructure", etc.)
-- taken directly from the routing doctrine's own examples. These are
-- not claims that CHEW offers or has a provider for any of them —
-- availability is computed at query time from whether an ACTIVE,
-- READY provider is linked, and today none are.
--
-- Do NOT add rows to network_providers here or anywhere else without
-- real business authority to classify that relationship, real
-- disclosure language, and real licensing/jurisdiction facts. See
-- CAPABILITY_NETWORK.md.

INSERT INTO capabilities (slug, name, category, description) VALUES
  ('insurance_risk_review', 'Insurance / Risk Review', 'risk',
   'Reviewing a client''s exposure and connecting them to licensed insurance coverage where a gap exists.'),
  ('digital_business_infrastructure', 'Digital Business Infrastructure', 'infrastructure',
   'Websites, booking systems, and other digital infrastructure a business needs to operate.'),
  ('real_asset_execution', 'Real-Asset Execution', 'real_assets',
   'Execution support for property and other real-asset transactions.'),
  ('accounting_tax', 'Accounting / Tax', 'tax_accounting',
   'Licensed accounting and tax preparation/filing support.'),
  ('event_production', 'Event Production', 'life_events',
   'Planning and coordination support for weddings and other major events.'),
  ('transportation_logistics', 'Transportation / Logistics', 'life_events',
   'Coordinating transportation for a major event, move, or business need.'),
  ('security_protection', 'Security / Protection', 'risk',
   'Physical or digital security support where a client''s situation calls for it.'),
  ('property_care', 'Property Care', 'real_assets',
   'Cleaning, upkeep, or management support for a property a client owns or occupies.'),
  ('relocation_logistics', 'Relocation / Storage', 'life_events',
   'Coordination support for moving households or belongings.')
ON CONFLICT (slug) DO NOTHING;
