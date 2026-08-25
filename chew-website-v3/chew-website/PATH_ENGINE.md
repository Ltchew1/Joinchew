# Path Engine — Status Report

This document exists because the code should never overstate what it does.
It says, plainly, what part of the "Life, Business, Career & Ownership
Intelligence" vision is real today, what part is architecture waiting for
data, and what part still needs an external integration that does not
exist yet. Update it whenever coverage changes — do not let it go stale.

## What is real right now

- **A working schema** (`db/schema.sql`): `jurisdictions`, `sources`,
  `business_types`, `path_requirements`. Each requirement links to a real
  source row (name, authority level, URL) and a real jurisdiction row, and
  carries `verification_status` + `last_verified_at` so nothing can be
  displayed without saying how it was checked.
- **A working query engine** (`lib/pathEngine.js`): given a business type
  and a state (optionally county/city), it returns the actual matching
  `path_requirements` rows plus a computed coverage status. It never
  invents a step. If nothing matches, it returns an empty `steps` array
  and `GENERAL_GUIDANCE` — that is the honest answer, not a placeholder.
- **A working API** (`api/business-path.js`): `GET /api/business-path?
  businessType=...&state=...[&county=...][&city=...]`. Validates input,
  calls the engine, returns JSON. No mock data path exists in production
  code — every response comes from the database. Gated server-side by
  the `path_engine` feature flag (see `FEATURE_FLAGS.md`) — a real 404,
  not just an unlinked page, is what stands between this and being
  "off." Currently seeded `preview` status (API-accessible, but not
  `live` — an honest description of a one-jurisdiction slice), with
  `public_teaser_enabled = FALSE` since it already has its own
  honestly-scoped link elsewhere on the homepage.
- **A working frontend** (`business-pathfinder.html`): a real form wired
  to the real API, rendering all three coverage states (VERIFIED / PARTIAL
  / GENERAL_GUIDANCE) with the exact required copy for each. Marked
  `noindex` and labeled "Early Preview" in its own copy so it does not
  read as a finished product. Linked from the homepage's "Bigger Picture"
  section as an early preview, not added to primary site navigation.
- **Exactly two verified facts** (`db/seed-path-engine.sql`), each
  corroborated via web search against the issuing authority (not fetched
  live — see "Known limitation" below), each dated `2026-08-25`:
  1. Florida LLC formation — Articles of Organization, Florida Division of
     Corporations (Sunbiz), $125 total ($100 filing + $25 registered agent
     designation), sequence step 1.
  2. Federal EIN — IRS, free, applies nationally, sequence step 2,
     `depends_on_id` pointing at step 1 (you need the LLC filed first).

That's it. Two facts, one jurisdiction (Florida), one business type
(general LLC formation). Everything else the tool is asked about —
another state, a licensed trade like a barbershop or restaurant, a
county- or city-level requirement — correctly returns "not covered yet"
instead of a guess. The UI options for those are explicitly labeled
"— not yet covered" rather than presented as if they worked.

## Known limitation: how "verified" facts were actually checked

This sandbox's outbound fetcher (`WebFetch`) is blocked from reaching
`.gov` domains directly (`www.irs.gov` and `dos.fl.gov` both returned
`EGRESS_BLOCKED`). `WebSearch` does work. So the two seeded facts above
were corroborated through web search results describing those official
fees and forms, not pulled live from the primary source in this session.
That's why `verification_status` on both rows is `manually_verified`,
not `verified` — `verified` is reserved for a fact confirmed by a direct
live pull from the primary source, which production (outside this
sandbox) should be able to do. Any future ingestion pipeline that can
reach `.gov`/official sources directly should re-check these two rows and
upgrade them to `verified` once confirmed, and should never mark a row
`verified` without that direct check.

## Architectural-only (schema exists, deliberately holds zero rows)

- `education_programs`, `careers`, `jobs` — tables are created in
  `db/schema.sql` with comments describing their intended shape, but
  contain no seed data and nothing in the codebase queries them yet.
  They exist so that when a real data source is connected, there is a
  place to put it without another schema migration.
- **County/city-level jurisdiction matching** — `jurisdictions` supports
  county and city rows, and `getBusinessPath()` accepts `county`/`city`
  params, but no county- or city-level `path_requirements` rows exist yet,
  and the matching logic in `lib/pathEngine.js` only distinguishes
  "national" vs. "state" specificity today. Extending it to actually
  resolve a county/city-specific requirement (e.g., a local business
  license) is straightforward given the schema, but has not been built or
  tested because there is no verified local data to test it against yet.
  Do not add fabricated county/city rows to unblock this — wait for real
  data.

## Still needs external integration (not started)

Everything else named in the original 30-phase vision is out of scope for
this MVP and has no code behind it yet:

- Any state other than Florida, for LLC formation.
- Any business type other than general LLC formation (cleaning services,
  barbershops, restaurants, contractors, every licensed trade, etc.),
  including their state/local licensing requirements.
- GED/education program listings, live job listings, career pathway data.
- Trademark search, business acquisition/investment analysis.
- Any live/authoritative-source ingestion pipeline — right now every row
  is hand-seeded and hand-verified; there is no scraper, API integration,
  or scheduled re-verification job. Building real, current coverage at
  scale requires either licensed data feeds (e.g., a jobs API, a licensing
  database) or a maintained ingestion process that can reach primary
  sources directly and re-check `last_verified_at` on a schedule — neither
  exists yet.

## Testing performed

This repository has no automated test suite and no build step
(`package.json` has no `scripts` key; dependencies are just `stripe`,
`pg`, `resend`). So "run all tests and the production build" was
satisfied the only way actually possible here — real, manual, scripted
verification instead of `npm test`/`npm run build`:

- Started a real local PostgreSQL 16 cluster and applied the full
  `db/schema.sql` (all tables, old and new) and `db/seed-path-engine.sql`
  against a scratch database with zero errors.
- Wrote and ran a Node test harness against `lib/pathEngine.js` covering
  four real scenarios: Florida (full match → VERIFIED, 2 steps), Florida
  + a county (→ PARTIAL, 2 steps, since county-level matching isn't
  implemented), California (→ PARTIAL, 1 step — only the national EIN
  step applies), and an unsupported business type (→ GENERAL_GUIDANCE, 0
  steps). All passed as designed.
- Wrote and ran a mock request/response harness against
  `api/business-path.js`: missing params → 400, wrong HTTP method → 405,
  a real Florida query → 200 with VERIFIED/2 steps, an unsupported type →
  200 with GENERAL_GUIDANCE. All passed.
- Ran a temporary local HTTP server serving the real static site and
  proxying `/api/business-path` to the real handler function (same code,
  swapped only the database connection to the local test database), and
  drove `business-pathfinder.html` in an actual Chromium browser via
  Playwright. Confirmed all three coverage states render with the correct
  required copy, correct data, and zero JavaScript console errors.
- None of this test infrastructure (local Postgres cluster, scratch
  database, temporary dev server) is part of this repository — it was
  scratch-only and has been torn down.
