# Feature Flags & Visual Expansion — Status Report

Companion to `PATH_ENGINE.md` and `CAPABILITY_NETWORK.md`. Covers the
shared feature-status registry ("hidden UI is not security," "do not
hard-code future feature cards") and the homepage visual/coming-soon
pass built against three successive directives in this session — a
visual/coming-soon directive, then a "Complete Master Build Directive"
that expanded the status vocabulary and the registry requirement, then
a duplicate of the first and a shorter follow-up reinforcing the same
rules. This file reflects the current, final state — the vocabulary
below superseded an earlier three-state version (`locked`/`coming_soon`/
`active`) partway through this work; nothing below describes that
earlier version except where noted for migration history.

## The registry: real server-side enforcement, real public metadata

- **Schema** (`db/schema.sql`, `feature_flags` table) uses the
  5-state vocabulary the directive specified: `internal` → `locked` →
  `preview` → `beta` → `live`. A separate `public_teaser_enabled`
  boolean controls whether a feature is shown publicly at all — a
  feature can be built and even API-accessible while
  `public_teaser_enabled = FALSE` (not shown), and a feature can be
  publicly teased as "Coming Soon" while still fully `locked` at the
  API. Two `CHECK` constraints enforce the directive's own rules at the
  database layer, not just in code: an `internal` feature can never have
  `public_teaser_enabled = TRUE`, and a teased feature must carry
  `public_title` + `public_description` — a row simply cannot be
  inserted in a state that violates either rule. Verified in testing:
  both invalid inserts were rejected by Postgres.
- **`lib/featureFlags.js`**: `isFeatureActive(slug)` grants API access
  for `preview`, `beta`, and `live` only — never `internal` or `locked`.
  Fails closed on an unregistered slug or a database error. Verified:
  `isFeatureActive('unknown_slug')` returns `false`.
- **Real enforcement, not hidden UI**: `api/business-path.js` and
  `api/capability-routing.js` call `isFeatureActive()` before doing any
  work and return a genuine `404 {"error":"Not found"}` when not
  accessible. Verified end-to-end by flipping `path_engine` through
  `preview → locked → beta` against a live database and calling the
  handler directly at each step: `200` → `404` → `200`.
- **`api/feature-flags.js`** is now the single source of truth the
  homepage reads to render its cards — titles, descriptions, and status
  live in the database, not in `index.html`. It returns only rows with
  `public_teaser_enabled = TRUE` (enforced in `getPublicFlags()`'s SQL,
  not by this handler), each with `isAccessible` computed from status.
  An `internal` feature is invisible even if its slug were mistakenly
  added to the handler's allowlist, because the database-level
  constraint means it can never have `public_teaser_enabled = TRUE` in
  the first place.
- **Homepage cards are no longer hard-coded.** `index.html`'s
  `#expansion-grid` starts empty (with a `<noscript>` static fallback
  carrying the same copy, for no-JS/SEO); `script.js` fetches
  `/api/feature-flags` and builds each card's markup from the response.
  A card's badge reads "Coming Soon" while status is
  `internal`/`locked` and switches to "Explore" the instant status
  reaches `preview`/`beta`/`live` — verified live by flipping
  `business_intelligence_suite` from `locked` to `live` against the
  database mid-test and confirming the badge updated with zero
  JavaScript errors and no code change.
- **Current registry state**: `path_engine` and `capability_network` are
  `preview` (not `live` — that's an honest description: one Florida LLC
  path, a capability taxonomy with zero providers) with
  `public_teaser_enabled = FALSE`, since each already has its own
  honestly-scoped link elsewhere on the homepage and a generic card
  would duplicate or understate that. The four "What's Next" teasers
  (`business_intelligence_suite`, `education_careers`,
  `asset_intelligence`, `chew_connections_suite`) are `locked` with
  `public_teaser_enabled = TRUE` — real cards, zero backend, true to
  what they are. Flip a flag only on an actual launch decision — never
  on inference from a document's tone.

## Visual pass: what was actually built

Multiple directives in this session asked for a full cinematic,
multi-scene visual rebuild across the entire site. Attempting that in
full, in text-only passes with no live design iteration, risks shallow
work claimed as done rather than a few things built and actually
verified — so each pass added one honestly-scoped, tested slice to the
homepage rather than attempting the whole site:

- **"The System Is Expanding" section**, now fully registry-driven (see
  above), styled as elegant locked states (restrained lock icon, subtle
  radial gold glow, pill badge) rather than gray disabled boxes.
- **Intelligence Pulse** (`.intelligence-pulse` in `styles.css`) — a
  reduced-motion-safe reveal animation applied to three real moments:
  the coming-soon cards' lock icons, the constellation's center CHEW
  node, and the rerouted-path endpoint in the "Path Reconstruction"
  diagram.
- **"Economic Constellation"** and **"Path Reconstruction"** — named
  badges added to two diagrams that already existed from earlier phases
  (an 8-node connected-domains diagram; a plan-interruption/reroute
  diagram), matching two of the directive's named signature elements.
- A real layout bug was caught and fixed only by rendering the change in
  an actual browser: the constellation's label, first placed inside a
  `display: flex` container, stretched to the SVG's full height and
  painted as an oversized gold block instead of a small badge — moved
  outside the flex wrap, reverified with a screenshot.
- Verified responsive behavior at a real mobile viewport (390×844): the
  four cards recompose to a single column and remain fully readable —
  not merely a shrunk desktop layout, though this relies on the site's
  pre-existing responsive grid breakpoints rather than new mobile-only
  interaction (no swipe gesture was built).

## "Tell CHEW where you're trying to go" — a real intelligence demo, not staged eye candy

A later directive ("Public Site Experience Supremacy") asked for roughly
fifteen named cinematic experiences (CHEW Move, Blind Spot, Domino,
Parallel Futures, Future-Back Planning, Opportunity Radar, Economic
Weather, a Life Map illumination graph, browseable "rooms," sound
design, a full opening activation sequence, and more), but its own
governing rule was explicit: *"Do not fake intelligence to create eye
candy... use actual architecture where available, otherwise use clearly
labeled demo scenarios."* Given that only one real reasoning engine
exists in this repository (`lib/intelligenceEngine.js` — see
`ARCHITECTURE.md`), building the other fourteen would have meant either
fabricating logic that doesn't exist or building believable-looking
animations with invented content — exactly what the directive itself
forbids. So this pass built exactly one thing, for real:

- **`api/intelligence-demo.js`** — a new, narrowly-scoped, public
  endpoint. Unlike `api/intelligence-recommendation.js` (which stays
  gated `internal` because there's no real subject/identity system —
  ARCHITECTURE.md Gap 1), this one is safe to expose publicly because it
  never accepts an arbitrary `subjectId`/`goalId`: it only ever computes
  against the two pre-seeded illustrative scenarios from
  `db/seed-intelligence.sql`, selected by a fixed `goal=home|funding`
  enum. Every response is wrapped with `isExample: true` and an explicit
  disclaimer. Gated by its own `intelligence_demo` flag (seeded `live`,
  since it's safe by construction), separate from `intelligence_engine`.
- **Homepage section "Tell CHEW where you're trying to go"** (added
  directly after the hero, without touching the hero's locked copy):
  two real goal buttons: clicking one calls the real engine and renders
  four stages — State, Constraints, Opportunities & Unlocks, and "The
  CHEW Move" — built entirely from the API's actual returned fields
  (`basedOnFacts`, `basedOnConstraints`, `relatedCapability`,
  `missingInformation`, `recommendedAction`, `rationale`). Nothing here
  is a scripted animation with placeholder content — verified by
  clicking both goals in a real browser and confirming each produces
  genuinely different output pulled from the live database (the credit
  score example correctly identifies "credit score" as the constraint
  in one path; the business example correctly identifies "bookkeeping"
  in the other), with zero JavaScript console errors, at both a 1280px
  desktop and a 390px mobile viewport (buttons wrap, stages stack
  full-width and stay readable).
- This delivers real, working versions of three of the directive's named
  concepts — "Tell CHEW where you're trying to go," the
  STATE→CONSTRAINTS→OPPORTUNITIES→UNLOCKS→PATH intelligence reveal, and
  "The CHEW Move" — grounded in the actual engine rather than staged.

## What was deliberately not attempted, across all of these directives

Naming these explicitly matters more than leaving them implied — none of
the following exist in this repository yet:

- The other three named signature elements as distinct components (CHEW
  Intelligence Line, CHEW Halo beyond the pre-existing hero ring-pulse,
  Locked Reveal as its own visual system) and any WebGL/canvas layer.
- The 12–15-scene cinematic homepage restructure as literally specified.
  Several scenes' underlying content already existed from earlier
  phases (fragmentation → connection → goal path → interference/reroute
  → decision intelligence → secret-weapon teaser → founder → final
  invitation), but none were restructured into the directive's exact
  scene numbering, and no scene received new cinematic composition, 3D
  depth, or a dedicated "CHEW Noticed" / Decision Lab / CHEW BUILD
  treatment — those concepts have no page presence at all yet.
- Applying any visual standard to other pages (about, services, apply,
  contact, education, legal pages) or to error/loading/empty states
  beyond what already existed.
- Site/portal visual continuity — no authenticated portal exists in this
  repository to share a design system with.
- A generalized `ComingSoonFeature`/`FeaturePreview` component in a
  component framework — this repo has no templating system or build
  step, so the real implementation is a hand-written render function in
  `script.js` reading from the registry API, not a literal reusable
  component in the React/Vue sense, though the pattern (one render path,
  driven entirely by data) is the architectural equivalent.
- Analytics instrumentation (CTA clicks, teaser views, etc.) — no
  analytics provider is wired into this site at all yet, for anything.
- SEO infrastructure beyond what already existed (sitemap, schema
  markup, systematic Open Graph audit across pages) and design-token
  centralization beyond the existing CSS custom properties in
  `styles.css`'s `:root`.
- The 5-status vocabulary is currently consumed only by this website.
  There is no authenticated portal in this repository yet for it to be
  "shared" with — the registry is built as if that consumer exists
  (nothing here is website-specific), but that's unverified until a
  portal actually reads from it.
- From the "Public Site Experience Supremacy" directive specifically:
  the opening "system wakes up" activation sequence; an interactive Life
  Map with illuminating node relationships (the existing constellation
  is static, not interactive); CHEW Blind Spot, CHEW Domino, Parallel
  Futures, Future-Back Planning, and Opportunity Radar (each would need
  a real engine capability this repo doesn't have — conflicting-priority
  detection, cascading-consequence modeling, multi-path scenario
  comparison, reverse planning, and time-bounded opportunity tracking
  are all Phase 2/3+ per `ARCHITECTURE.md`, not yet real); Economic
  Weather and "What Changed?" (both need state-over-time tracking this
  repo doesn't build — see ARCHITECTURE.md's Outcome entity, still
  conceptual); Hidden Leverage, Friction Detection, and Conflict
  Detection (each needs pattern-recognition across a subject's history
  that doesn't exist for one seeded test subject); the five "browseable
  rooms"; sound design; and a bespoke mobile choreography beyond the
  existing responsive breakpoints. Building fake versions of any of
  these would have meant exactly the "eye candy without architecture"
  the directive itself prohibited.

## Testing performed

No automated test suite or build step exists in this repo. Verified
instead with real, scripted tests against a live local PostgreSQL 16
database and a real Chromium/Playwright browser session each time this
system changed:

- Full `db/schema.sql` applied cleanly from scratch, including both
  `CHECK` constraints on `feature_flags`; both constraints confirmed to
  reject an invalid insert (`internal` + teased; teased without
  title/description).
- `isFeatureActive()` and the gated APIs exercised through every status
  transition (`preview → locked → beta → preview`), confirming 200/404
  at exactly the right points, by calling the handler functions
  directly — the same call path a real request takes.
- `api/feature-flags.js` confirmed to hide `path_engine`/
  `capability_network` (teaser disabled) while showing the four teased
  features with correct metadata; confirmed a flipped-to-`live` feature
  reports `isAccessible: true`.
- A real browser session confirmed the homepage renders all four cards
  from the API response (not hard-coded HTML), at both a 1280px desktop
  viewport and a 390px mobile viewport, with zero JavaScript console
  errors, and confirmed a live flag flip updates a card's badge with no
  code change.
- No local test infrastructure (Postgres cluster, scratch database, dev
  server) is part of this repository.
