# Capability Network — Status Report

Companion to `PATH_ENGINE.md`. This document says plainly what part of
the routing/affiliation/execution ecosystem doctrine is real code today,
what part is architecture waiting for real business data, and what
still needs a human with actual authority over these relationships.
Update it whenever a real provider is added — do not let it go stale.

## What is real right now

- **A working schema** (`db/schema.sql`): `capabilities` (the taxonomy
  of needs CHEW can recognize), `network_providers` (who can actually
  fulfill a capability, with `relationship_classification`, `status`,
  disclosure, licensing, and readiness fields), `capability_provider_links`
  (which provider serves which capability, with eligibility/prerequisite
  notes), `routing_consents` (a real consent log for sharing client data
  with a provider), and `routing_events` (an analytics stub that records
  "routed," "not yet needed," and "no provider available" outcomes alike
  — not just successes).
- **A structural honesty rule enforced by the database itself, not just
  convention**: `network_providers` has a `CHECK` constraint that makes
  it impossible to insert an `affiliated_enterprise` row without
  `disclosure_text`. Verified in testing — an insert without disclosure
  text was rejected by Postgres; the identical insert with disclosure
  text succeeded. There is no code path that can route a client to an
  affiliated company without a disclosure to show them.
- **A working query engine** (`lib/capabilityGraph.js`):
  `getCapabilities()` lists the taxonomy; `getRoutingRecommendation()`
  returns only providers where `status = 'active' AND is_ready = TRUE`
  for a given capability. This filter runs in the SQL query itself, not
  in application logic — verified in testing by seeding one `hidden`
  provider and one `active` provider on the same capability and
  confirming the hidden one never appears in the result, under any
  request shape. `recordRoutingEvent()` and `recordConsent()` are real,
  functional insert helpers, ready for a real handoff flow to call.
- **A working API** (`api/capability-routing.js`), gated server-side by
  the `capability_network` feature flag (see `FEATURE_FLAGS.md`) — a
  real 404 when off, not just an unlinked page. Currently seeded
  `preview` status (API-accessible, not `live`), `public_teaser_enabled
  = FALSE` since it has its own honestly-scoped link elsewhere on the
  homepage rather than a generic teaser card.
  `GET /api/capability-routing` (no params) lists the capability taxonomy;
  `GET /api/capability-routing?capability=<slug>` returns that
  capability's real routing recommendation. Both paths tested against a
  live database, including the "capability exists but has zero active
  providers" case, which correctly returns `available: false` rather
  than inventing a placeholder.
- **Four seeded capability categories** (`db/seed-capabilities.sql`):
  `insurance_risk_review`, `digital_business_infrastructure`,
  `real_asset_execution`, `accounting_tax` — taken directly from this
  doctrine's own examples. These are category labels only. Seeding them
  is not a claim that CHEW has a provider for any of them; it gives the
  graph a taxonomy to route against once real providers exist.
- **A one-line, honest homepage mention** (index.html, "Bigger Picture"
  section): states that CHEW is expanding the network of vetted
  capability available through the platform and that any material
  relationship is disclosed plainly. It does not name a specific
  provider, does not claim any capability is available yet, and does
  not use "CHEW Partners" or "sister company" language anywhere.

## Zero fabricated providers — and why that's not a gap to fill quickly

`network_providers` holds **zero rows**, on purpose, and that is a
harder constraint here than it was for the Path Engine. The Path
Engine's two seeded facts (Florida LLC filing fees, the EIN) are public
government facts I could corroborate through search. Which companies
are actually affiliated with CHEW, what their real relationship
classification is, what licensing they hold, what disclosure language
is legally accurate for each one — **none of that is public or
discoverable by me.** It is proprietary business information that only
someone with real authority over those relationships can supply
accurately. Inventing a plausible-looking provider row would be exactly
the fabrication this doctrine forbids, so the schema and engine are
built, tested, and ready, and the provider table is empty until that
information is provided.

To add a first real provider once that information exists:
1. Insert a `network_providers` row with the true
   `relationship_classification`, `status = 'active'` only once genuinely
   ready, real `disclosure_text` if it's an `affiliated_enterprise`, and
   real licensing/jurisdiction/contact-method fields.
2. Link it to the relevant `capabilities` row via
   `capability_provider_links`, with real eligibility/prerequisite notes.
3. Set `is_ready = TRUE` only after the checklist in "Provider readiness"
   below is actually true for that provider.
4. Update this document's "What is real" section to name it.

## Architectural-only (built, but not yet exercised by real data)

- **Provider readiness checklist** — the doctrine's list (service status,
  jurisdiction, licensing, contact/routing method, intake process,
  eligibility, disclosure language, data-sharing requirements, escalation
  process) maps onto real columns (`is_ready`, `licensing_notes`,
  `contact_method`, `intake_process_notes`, `data_sharing_notes`,
  `disclosure_text`), but there is no automated verification of any of
  these yet — `is_ready` is a manual flag, not a computed one. Building
  automated readiness checks has no value until there's a real provider
  to check.
- **"You don't need this yet" eligibility logic** — `eligibility_notes`
  and `prerequisite_notes` are free-text fields on
  `capability_provider_links`, ready to hold real criteria, but there is
  no client-profile schema yet to match against, so nothing evaluates
  them programmatically. That requires a real client-profile data model,
  which doesn't exist in this codebase yet.
- **Closed-loop handoff** ("outcome returns to CHEW where appropriate and
  authorized") — `routing_events` can record that a handoff happened, but
  there is no mechanism for a provider to report an outcome back. That
  needs an actual integration (webhook, shared portal, or manual entry
  process) with each real provider, which can't be designed generically
  in advance of knowing who the providers are.
- **Consent UI** — `routing_consents` and `recordConsent()` are real and
  functional, but no page or flow calls them yet, because there is
  nothing to consent to route to. Building that UI now would either be
  empty scaffolding or would have to fake a provider to demonstrate —
  both were judged not worth doing yet. Wire it up when the first real
  provider is added.

## Still needs external/business input (not started)

- Every actual affiliated company, licensed specialist, or outside
  provider — names, real relationship classification, licensing,
  jurisdictions, disclosure language, contact/intake process. This is
  the single largest gap and can only be closed with input from whoever
  holds those business relationships.
- Feature flags / permissions system referenced by the doctrine
  ("permissions," "feature flags") — no flag system exists in this
  codebase; `status` on `network_providers` currently serves as the only
  gate, which is sufficient for the current scale but not a general
  feature-flag system.
- Full data-sharing consent UI (show exactly what will be shared, get
  explicit consent, display it back to the client) — backend is ready;
  no frontend exists.

## Testing performed

Same approach as `PATH_ENGINE.md` — no automated test suite or build
step exists in this repo, so this was verified with real, scripted
tests against a live local PostgreSQL 16 database:

- Applied the full `db/schema.sql` (all tables, old and new) cleanly
  against a scratch database.
- Confirmed the `affiliated_enterprise` + missing `disclosure_text`
  `CHECK` constraint rejects the insert, and the same insert with
  disclosure text succeeds.
- Ran a Node harness against `lib/capabilityGraph.js`: capability
  taxonomy listing, a capability with zero providers (correctly
  `available: false`), an unknown capability slug (correctly returns
  `capability: null`), and — after seeding one `hidden` provider and one
  `active`+`is_ready` provider on the same capability — confirmed only
  the active provider is ever returned, never the hidden one.
  `recordRoutingEvent()` and `recordConsent()` were exercised and
  confirmed to insert real rows.
- Ran a mock request/response harness against
  `api/capability-routing.js`: wrong HTTP method → 405, no `capability`
  param → 200 with the taxonomy list, a real capability with zero
  providers → 200 with `available: false`, a capability with an active
  provider → 200 with that provider's data.
- No local test infrastructure (Postgres cluster, scratch database) is
  part of this repository.
