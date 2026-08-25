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

## Two more signature moments — "Visual Supremacy & Experience Maxout"

This directive changed one rule from the prior one: clearly-labeled
demo/sample states are now explicitly permitted for visual spectacle,
even without a real engine behind them ("build clearly labeled demo,
sample, preview, simulation, or exhibit states"). It also explicitly
warned against the opposite failure mode — "do not create 20
half-finished experiences... build in production-quality slices... then
move to the next slice." Given that instruction, and given the user's
own follow-up scoped this to the public site only ("do not expose
private/member-only functionality" — there is no portal in this
repository to build, and creating one would require a full identity/auth
system, ARCHITECTURE.md Gap 1), this pass built exactly two of the
directive's ~12 named signature moments to real production quality
rather than attempting all twelve shallowly:

- **CHEW Activation** — a brief (under 2.5s), skippable opening sequence
  on the homepage: darkness, two architectural lines draw outward from
  center, the CHEW mark resolves with a gold glow, the wordmark fades in
  beneath, then the whole overlay fades to reveal the page. Pure
  opacity/transform CSS animation (`styles.css`), no new dependencies,
  no blocking of interaction underneath. Session-scoped via
  `sessionStorage` — verified in a real browser to play once, then stay
  instantly hidden on a same-session reload, so it can never become
  annoying on repeat visits. Under `prefers-reduced-motion`, verified to
  skip to hidden instantly with zero animation. Skippable by
  click/tap at any point.
- **The CHEW Move collapse/reveal** — enhances the existing "Tell CHEW
  where you're trying to go" section (see below) with the dramatic
  "many candidates narrow to one" moment the directive asked for by
  name, built entirely from real data already returned by the engine:
  every requirement the engine actually evaluated renders as a chip,
  then resolves — met ones dim to near-transparent, the deferred one(s)
  recede slightly, and the real chosen requirement (a new
  `chosenRequirementKey` field added to `lib/intelligenceEngine.js`'s
  response specifically so the frontend never has to guess which
  candidate was "the one" by fragile text-matching) expands and glows
  gold before the full detail card appears beneath it. Verified in a
  real browser: chips render unresolved immediately after clicking a
  goal, resolve correctly ~650ms later with the right chip
  highlighted (confirmed for both seeded scenarios — "Credit Score" for
  the housing example, and separately verified the API correctly
  reports different chosen keys per scenario), and the full chain fades
  in only after the chips settle — not simultaneously. Under
  `prefers-reduced-motion`, verified everything resolves and becomes
  visible instantly, no staggered delay.
- Both were tested at a 390px mobile viewport: the activation sequence
  scales correctly, and the chip row wraps to its own line with the
  highlighted chip still clearly readable.

## CHEW Blind Spot — the interrupt moment, built from real data with zero new backend

The directive's own example — "User thinks: Raise score. Then CHEW
detects: BLIND SPOT" — maps almost exactly onto data the intelligence
engine already returns, so this needed no new API and no fabricated
content:

- **"Assumed"** is the real deferred requirement — any other requirement
  in `basedOnFacts` that's unmet but *isn't* `chosenRequirementKey`.
  Framed explicitly as *"a common focus in this situation (not
  necessarily yours)"* rather than a claim about what the actual visitor
  is thinking — there is no personalization in this repo to back a
  stronger claim, and the copy says so.
- **"Actual"** is the real `chosenRequirementKey` the engine already
  computed — the same value already highlighted in the CHEW Move
  collapse chips, so the Blind Spot panel and the collapse animation
  never contradict each other (they're reading the same field).
- If there's no second unmet requirement to contrast against, the panel
  stays hidden rather than being forced to show something — verified
  this is the only condition that suppresses it (`chosenRequirementKey`
  null, or every other requirement already met).
- Deliberately distinct visual language from the soft glass `.reveal-stage`
  cards it sits next to — sharp left border, near-black field,
  struck-through "assumed" text against bold italic gold "actual" text —
  so it reads as an interruption in the flow, not another card in a
  list, per the directive's explicit ask.
- Verified end-to-end against the live database and in a real browser
  for both seeded scenarios: housing correctly shows "Down Payment
  Savings Cents" as assumed vs. "Credit Score" as actual; the business
  scenario correctly shows "Has Business Bank Account" as assumed vs.
  "Bookkeeping Current" as actual — both cross-checked against the raw
  API response, not eyeballed. Confirmed the panel appears after the
  CHEW Move chips resolve and before the full detail chain fades in, not
  simultaneously with either. Confirmed instant with zero animation
  under `prefers-reduced-motion`, and readable at a 390px mobile
  viewport.

## CHEW Domino — a real cascade simulation with a hard safety rule

The directive's example ("Complete documentation → readiness improves →
pathway opens → requirement clears → milestone activates → opportunity
appears") maps onto a real capability of this repo's intelligence
engine: completing a requirement really does change which requirement
becomes CHEW's next real focus, and that's already fully built and
tested (see the action/task tracking and Opportunity Engine wiring
milestones). The design question this moment forced was **whether the
public demo should call that real, database-writing code path** — and
the answer had to be no.

Both this feature and the existing "Tell CHEW where you're trying to
go" section share one fixed, seeded illustrative subject
(`intel_subjects` id 1). If a public, unauthenticated, repeatable-by-
anyone "Domino" button actually called `completeAction()`, the first
visitor to click it would permanently alter that shared subject's real
facts — completing `credit_score` for real would silently change the
housing scenario's starting state for every visitor after them, and a
second click on an already-completed action would just fail outright
(actions can only be completed once). There's no per-visitor identity
in this repo to sandbox a private copy of the scenario against (Gap 1),
so a mutating public demo would either break itself after one use or
require infrastructure this pass doesn't build.

The resolution: `api/intelligence-demo.js` now also returns
`requirementSequence` — the real, ordered `transition_requirements` rows
for the scenario (with real capability links where they exist), a
read-only enrichment, same class of non-sensitive rules metadata
`api/business-path.js` already exposes. The frontend uses this plus the
already-fetched real current facts to **simulate exactly one step
forward** — treating the currently-chosen requirement as if it had just
been completed, and showing the real, deterministic consequence of that
(which requirement becomes the next real focus, whether it's tied to a
real capability) — without calling `completeAction()` or writing
anything. The panel is labeled explicitly: *"Simulated walkthrough of
CHEW's real rules for this example, in order — nothing here is saved or
completed for real."* This is deliberately bounded to one hypothetical
step, not a chain of invented completions, to stay as close to "real"
as an unauthenticated demo honestly can.

Building this caught a real latent bug before it shipped: the initial
version located "the next tile" by checking `tiles[chosenIndex + 1]`
against the rendered DOM list, which — for the edge case where the
chosen requirement happens to be the *last* one in sequence — would
have matched the synthetic "Pathway Clear" tile as if it were a real
next requirement, then crashed accessing `undefined.capabilitySlug`.
Neither seeded scenario naturally reaches that state (the chosen
requirement is never actually last in either), so this wouldn't have
surfaced in the two demo paths alone. Caught by deliberately forcing the
edge case — inserting a real `credit_score = 700` fact so
`down_payment_savings_cents` (the last item) became the chosen one — and
verified fixed by checking against `requirementSequence.length` instead
of DOM presence. Confirmed clean in the browser afterward: the "Pathway
Clear" tile correctly activates with zero errors.

Also verified: re-fetching `/api/intelligence-demo` immediately after
running the Domino simulation confirms `chosenRequirementKey` is
unchanged for both scenarios — direct proof the simulation performs zero
writes, not just an assumption from reading the code. Tested instant
behavior with zero animation under `prefers-reduced-motion`, and
confirmed the capability connection line ("Connected to: Accounting /
Tax") renders correctly on the funding scenario's first tile.

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
- From the "Public Site Experience Supremacy" / "Visual Supremacy &
  Experience Maxout" directives: the opening activation sequence and the
  CHEW Move collapse are now built (see above) — everything else on
  their lists is still not attempted. Worth being precise about *why*,
  because the reason differs by item now that clearly-labeled demo data
  is explicitly permitted:
  - **Blocked by a real constraint, not a choice**: the portal entirely
    (there is no authenticated portal in this repository, and building
    one needs real identity/auth — ARCHITECTURE.md Gap 1 — which is a
    security-relevant foundation, not a visual-layer decision to make
    inside a design pass); an interactive Life Map with illuminating
    node relationships tied to real state (the existing constellation is
    static and illustrative-only, not wired to any subject's data);
    Economic Weather, "What Changed," Hidden Leverage, Friction
    Detection, and Conflict Detection (each needs either state-over-time
    tracking or pattern-recognition across a subject's history that
    doesn't exist for the one seeded test subject — building these even
    as "demo" would mean fabricating a history that was never seeded,
    which is different from labeling a single static scenario as an
    example).
  - **Just not built yet, execution-bandwidth only**: Parallel Futures,
    Future-Back Planning, Opportunity Radar, the five "browseable
    rooms," sound design, and a bespoke mobile choreography beyond the
    existing responsive breakpoints (CHEW Blind Spot and CHEW Domino are
    no longer on this list — see above, both now built). None
    of these need a capability this repo lacks to build as a
    clearly-labeled demo/sample exhibit — they're exactly the kind of
    thing this directive now explicitly permits. They weren't built in
    this pass because the directive's own "Implementation Discipline"
    section explicitly warned against 20 half-finished experiences in
    favor of a few done to real production quality — two were chosen,
    not twelve attempted shallowly. These are the natural next slices.

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
- **CHEW Activation + CHEW Move collapse, verified in a real browser:**
  confirmed the activation overlay auto-hides itself after its sequence
  completes; reloaded the page and confirmed it stays hidden instantly
  (session-scoped, no replay); confirmed zero JS errors through the full
  flow. Confirmed the move-collapse chips render unresolved immediately
  after selecting a goal, then resolve ~650ms later with the correct
  chip highlighted — cross-checked against the API's own
  `chosenRequirementKey` field for both seeded scenarios, not assumed.
  Confirmed the full detail chain only fades in after the chips settle,
  not simultaneously. Re-tested both moments under
  `prefers-reduced-motion`: activation hidden instantly, chips resolved
  instantly, chain visible instantly — no animation, no delay. Verified
  both at a 390px mobile viewport: activation scales correctly, chip row
  wraps with the highlighted chip still clearly readable.
- **CHEW Blind Spot, verified in a real browser against both seeded
  scenarios:** confirmed via a direct `curl` of `/api/intelligence-demo`
  that housing's real `chosenRequirementKey` is `credit_score` with
  `down_payment_savings_cents` the only other unmet requirement, and
  funding's is `bookkeeping_current` with `has_business_bank_account`
  the only other one — then confirmed the rendered panel's "assumed" and
  "actual" labels matched exactly for both, not merely that *a* panel
  appeared. Confirmed the panel is hidden until data arrives and reveals
  itself after the CHEW Move chips resolve, before the full chain fades
  in. Confirmed instant with zero animation under
  `prefers-reduced-motion`, and readable at a 390px mobile viewport.
- No local test infrastructure (Postgres cluster, scratch database, dev
  server) is part of this repository.
