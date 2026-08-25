-- CHEW Intelligence System — MVP illustrative test scenario
--
-- This seeds exactly one transition, its requirements, one synthetic
-- test subject, a partial set of facts, and one constraint — enough to
-- exercise lib/intelligenceEngine.js end-to-end.
--
-- IMPORTANT — the numeric thresholds below (credit score 620, $20,000
-- down payment) are ILLUSTRATIVE ONLY, chosen to be plausible enough to
-- test the engine's comparison logic. They are NOT verified mortgage
-- lending guidance, are NOT sourced from any lender or regulator, and
-- must never be surfaced to a real user as real advice. This is the
-- opposite honesty situation from PATH_ENGINE.md's seed data (real
-- government fees, corroborated by search) — here, the goal is only to
-- prove the engine computes and explains correctly from *some* rules,
-- not to assert real underwriting criteria. Do not remove this warning
-- when this scenario is ever replaced with a real, sourced one.
--
-- The test subject is NOT a real person. Its label says so. Do not
-- reuse subject id 1 for anything resembling a real user until real
-- identity/auth exists (see ARCHITECTURE.md, Gap 1).

INSERT INTO transitions (slug, name, from_state_label, to_state_label, description, category) VALUES
  ('renter_to_homebuyer_ready', 'Renter to Homebuyer-Ready', 'Renter', 'Homebuyer-Ready (illustrative)',
   'Illustrative transition used to test the intelligence engine. Thresholds are examples, not verified lending guidance.',
   'housing')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO transition_requirements (transition_id, requirement_key, label, comparison, required_value, unit, sequence_order, action_if_unmet)
SELECT id, 'documented_income', 'Documented income', 'boolean_true', 'true', NULL, 1,
  'Gather two years of tax returns or recent pay stubs showing consistent, documentable income.'
FROM transitions WHERE slug = 'renter_to_homebuyer_ready'
ON CONFLICT DO NOTHING;

INSERT INTO transition_requirements (transition_id, requirement_key, label, comparison, required_value, unit, sequence_order, action_if_unmet)
SELECT id, 'credit_score', 'Credit score', 'gte', '620', 'FICO (illustrative threshold)', 2,
  'Work on paying down revolving balances to raise your credit score toward the illustrative 620 threshold.'
FROM transitions WHERE slug = 'renter_to_homebuyer_ready'
ON CONFLICT DO NOTHING;

INSERT INTO transition_requirements (transition_id, requirement_key, label, comparison, required_value, unit, sequence_order, action_if_unmet)
SELECT id, 'down_payment_savings_cents', 'Down payment savings', 'gte', '2000000', 'cents (illustrative $20,000 threshold)', 3,
  'Continue saving toward the illustrative $20,000 down payment threshold.'
FROM transitions WHERE slug = 'renter_to_homebuyer_ready'
ON CONFLICT DO NOTHING;

INSERT INTO intel_subjects (label) VALUES
  ('TEST SUBJECT — illustrative only, not a real user')
RETURNING id;

-- The statements below assume this is the first subject seeded in an
-- otherwise-empty database (id = 1), matching how this file is used in
-- this repository's own testing. Adjust the subject_id if seeding into
-- a database that already has rows.

INSERT INTO current_state_facts (subject_id, fact_key, fact_value, fact_type, source_note) VALUES
  (1, 'documented_income', 'true', 'user_provided', NULL),
  (1, 'credit_score', '580', 'user_provided', NULL);
-- Note: down_payment_savings_cents is intentionally NOT seeded, to
-- demonstrate the engine's missing_information output for a requirement
-- with no fact on file at all.

INSERT INTO goals (subject_id, transition_id, title, category, priority, target_date, status)
SELECT 1, id, 'Buy a first home (example)', 'housing', 1, (now() + interval '12 months')::date, 'active'
FROM transitions WHERE slug = 'renter_to_homebuyer_ready';

INSERT INTO constraints (subject_id, goal_id, constraint_type, description, is_resolved, blocks_transition_id)
SELECT 1, g.id, 'credit',
  'Revolving credit utilization is above the recommended threshold, which is likely suppressing the credit score.',
  FALSE, t.id
FROM goals g JOIN transitions t ON t.id = g.transition_id
WHERE t.slug = 'renter_to_homebuyer_ready' AND g.subject_id = 1;
