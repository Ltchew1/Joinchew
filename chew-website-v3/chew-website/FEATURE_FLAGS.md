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

## CHEW Opportunity Radar — every real capability, live, with no fabricated freshness

The directive's "Opportunity Radar" concept implies capabilities appearing,
expiring, or becoming newly available over time. Nothing in this schema
tracks a capability's freshness or a deadline — `network_providers` only
ever holds a current `status`/`is_ready` state, not a history of when that
became true. Inventing an "expiring soon" or "just opened" label would have
meant fabricating urgency the data doesn't support, which every directive in
this build has forbidden. So the Radar shows exactly what's real right now,
nothing more: all 9 capabilities from the registry, each honestly marked
**connected** (this example's real `requirementSequence` actually links a
`capability_id` to it) or not, and **available** (a live
`COUNT(...) FILTER (WHERE status='active' AND is_ready=TRUE)` is greater
than zero) or not.

`lib/capabilityGraph.js` gained `getCapabilityOverview()` — one aggregate
query returning all capabilities with their live active-provider count, so
the frontend gets every capability's state in the same round trip as the
rest of the demo response rather than 9 separate calls to the existing
single-capability routing endpoint. `api/intelligence-demo.js` now also
returns `capabilityOverview`. The frontend positions the 9 nodes radially
around a "This Example" hub using real trigonometry
(`angle = (360/n)*i - 90`), cross-references each against the real
`requirementSequence`, and — critically — never writes anything or calls
`completeAction()`, same hard rule as Domino.

For the funding scenario, exactly one of the 9 capabilities
(`accounting_tax`, via the real `bookkeeping_current` requirement link) is
connected; the home scenario connects to zero, and the detail panel says so
plainly rather than hiding the empty state: *"None of these real
capabilities are connected to this particular example's requirement
sequence — honestly, because this scenario doesn't currently route through
the network."* With no providers seeded in this environment, every node
honestly shows "No active provider yet" — leaning into that as the honest
signal rather than treating it as a visual weakness to paper over.

Building the mobile fallback caught a real bug: the radial layout's node
wrapper (`#radar-nodes`) kept `position: absolute; inset: 0` on mobile even
though the base `.radar-wrap` rule was overridden to a normal wrapped flex
row, which collapsed all 9 node buttons onto the exact same coordinates as
the hub (confirmed via `document.elementFromPoint()` returning the hub, not
a node, at a node's own bounding-box center). Fixed by also setting
`.radar-nodes { position: static; display: flex; flex-wrap: wrap; }` inside
the `max-width: 640px` query, verified afterward by the same
`elementFromPoint` check now correctly resolving to the node itself, and by
screenshot showing a clean two-column wrapped card grid with no overlap.

Verified the live-update claim directly rather than assuming it from the
query logic: seeded one real `network_providers` row (`status='active',
is_ready=TRUE`) and linked it to the `accounting_tax` capability via
`capability_provider_links` in the scratch database mid-test, re-fetched
`/api/intelligence-demo`, and confirmed `accounting_tax` flipped from
`activeProviderCount: 0, available: false` to `activeProviderCount: 1,
available: true` — then confirmed in the browser that the corresponding
radar node visually gained the `is-connected is-available` gold-highlighted
state and its detail panel correctly reported "1 active provider in the
network right now," before removing the seeded row and confirming the
node and API both reverted to the honest zero-state. This is the same
"prove it flips, don't just trust the SQL" standard applied to every prior
moment in this build.

Also confirmed goal-switching resets Radar state cleanly (hidden section,
cleared node list, cleared detail panel) mirroring the existing Domino reset
pattern, and confirmed zero JavaScript console errors across a 1280px
desktop viewport, a 375px mobile viewport, and under
`prefers-reduced-motion` (the sweep animation and node hover transforms are
disabled; a real click still fires the same handler and populates the same
detail panel — confirmed via a raw DOM-dispatched click after Playwright's
synthetic mouse-coordinate click proved unreliable specifically under
Chromium's reduced-motion test emulation, which is a test-tooling quirk,
not a product bug: the click listener itself fires correctly regardless).

## The CHEW Life Map — real curated relationships, not personalized data

A later directive ("Visual Supremacy, Digital World & WTF-Factor") asked for
the Life Map to become a full explorable economic world — territories as
"districts," selection reconfiguring node positions/lighting/pathways, and
a before/after "evolve" demonstration of a simulated action opening a
route. Given this repo's real constraint (no per-visitor identity or
subject state exists for the public site — ARCHITECTURE.md Gap 1, the same
constraint that keeps the general intelligence-recommendation API gated
`internal`), a Life Map "tied to real state" isn't buildable honestly yet.
What *was* buildable honestly: making the previously static, always-fully-
connected octagon (`The Economic Constellation`) into something that
actually responds, using real curated content instead of decoration.

The old diagram drew all 16 possible ring/spoke lines permanently visible —
it never claimed anything specific, it just looked like a network. The new
Life Map (`.lifemap-*` in `styles.css`, the `lifemap-wrap` block in
`script.js`) replaces that with 13 specific, named relationships between
the same 8 territories (Credit, Capital, Business, Property, Insurance,
Assets, Liquidity, Ownership) — e.g. "Business connects to Insurance: a
business carries exposure that personal insurance was never built to
cover." Selecting a territory illuminates only its real edges (an animated
gold dash-flow along lit connections, reduced to an instant state change
under `prefers-reduced-motion`) and dims everything else; a detail panel
lists each connection with its one-line reason. This is editorial content —
curated financial-relationship logic, the same class of claim the existing
caption beneath it already made ("A simplified view of how the pieces
relate, not a map of your accounts") — never fetched from a database, never
personalized, never claiming to have analyzed the visitor.

Accessibility was designed in from the start, not bolted on after: the SVG
is purely decorative (`aria-hidden="true"`), and a layer of 8 real
`<button>` elements is positioned over it via percentage `left`/`top`
matching the SVG's node coordinates on a fixed-`aspect-ratio` wrapper, so
keyboard and screen-reader users get the identical interaction real mouse/
touch users get — not a degraded fallback. Verified with a real keyboard
`Tab`-then-`Enter` activation in the browser, not just inferred from markup.

Tested in a real browser across all 8 territories individually at a 1280px
desktop viewport, under `prefers-reduced-motion`, and at a 375px mobile
viewport: for every territory, asserted the exact set of illuminated
connected nodes and lit edges against the curated `LIFEMAP_EDGES` data
(not just "something lit up") — all 24 assertions (8 territories × 3
viewports) matched precisely. Also verified clicking a selected territory
again deselects it, the "Clear selection" button fully resets state, and
zero JavaScript console errors occurred anywhere in the flow.

## CHEW Future-Back — the real requirement chain, walked in reverse

Of the directive's newly-named moments, Future-Back was the best fit for
this repo's real constraint: unlike Parallel Futures (which needs invented
hypothetical timelines — fastest/lowest-cash/lowest-risk — with no real
computed basis to draw from), Future-Back's entire premise is "start at the
destination and walk backward through what has to be true first," which
maps directly onto data the intelligence engine already computes: the real,
ordered `requirementSequence` and the real `chosenRequirementKey` (the
engine's own answer to "where are you today"). Nothing here is invented —
it's the same data CHEW Move, Blind Spot, and Domino already use, walked in
the opposite direction.

`api/intelligence-demo.js` gained one more real field: `goalTitle`, the
actual `goals.title` row for the scenario (e.g. "Buy a first home
(example)") — added instead of parsing it out of the recommendation's
free-text rationale string, which would have been fragile and implicit.

The frontend takes `chosenRequirementKey`'s position in `requirementSequence`
and splits on it: everything from that position to the end of the sequence
(the requirement CHEW is actually focused on today, plus everything still
ahead of it) becomes the backward-walking chain, reversed so the stage
closest to the goal appears first and the chosen requirement lands last,
labeled "TODAY — START HERE." Anything before that position — real,
already-met requirements — is summarized in one honest line below the
chain ("Already true, before this point in the chain: ...") rather than
folded into the forward-looking walk, since resolved history isn't a
future dependency. Handles the edge case where every requirement is
already met (no `chosenRequirementKey` at all) with its own honest stage
rather than crashing or showing an empty chain — verified directly by
forcing that exact state in the scratch database (updating the home
scenario's `credit_score` and `down_payment_savings_cents` facts to
passing values) and confirming the frontend rendered "Every real
requirement for this goal is already met in this example" with zero JS
errors, then reverting the facts back to the original seeded state.

Tested in a real browser against both seeded scenarios at a 1280px desktop
viewport, under `prefers-reduced-motion`, and at a 375px mobile viewport:
asserted the exact stage order, labels, and the "today" stage's position
and content against the real API response for every run (not just that
stages appeared), confirmed the resolved-history line appears only for the
home scenario (where `documented_income` is met before the chosen
requirement) and correctly does not appear for the funding scenario (where
the chosen requirement is first in sequence, nothing precedes it), and
confirmed goal-switching resets state synchronously — checked immediately
after the click via a microtask rather than after a fixed delay, since
under `prefers-reduced-motion` the next goal's fetch can resolve and
re-reveal the section within single-digit milliseconds, which a delayed
check would have wrongly read as a failed reset.

## The Network Room — the real capability registry, traced live (network-room.html)

A later directive ("CHEW Public Experience — Continue, Network Room Next")
named this the highest-leverage next module specifically because it could
reuse real, already-shipped infrastructure instead of building new
intelligence: `api/capability-routing.js` was already public (feature
`capability_network` has been `preview`-status, API-accessible, since an
earlier pass), read-only, and unused by any page. Network Room is the
first frontend to actually read from it.

The room asks the same question CHEW's real registry answers: when a need
is detected, how does it connect to a real capability? A visitor picks one
of 9 sample needs (illustrative phrasing, clearly marked `--sample-blue`
throughout — a new `:root` token added specifically so "this is sample
input" is never confused with "this is real registry structure," which
stays gold like the rest of the site) and CHEW traces the real chain: Need
→ Capability → Qualification Gate → Provider/Source → Consent Boundary →
Handoff → Outcome. Every stage past the Need is populated from a live
fetch — capability name/category/description, gate conditions
(`eligibilityNotes`/`prerequisiteNotes`/`documentsNeeded` from real
`capability_provider_links` rows), provider status, and now jurisdiction
(`lib/capabilityGraph.js`'s `getRoutingRecommendation` gained a
`jurisdictionLabel` field via a `LEFT JOIN jurisdictions`, additive and
non-breaking since no frontend consumed the raw `jurisdictionId` before
this). For categories with more than one real capability (risk,
real_assets, life_events all have 2-3), the Capability stage briefly shows
all real candidates in that category before marking the one that actually
matches — a genuine "considered, then narrowed" moment built from real
taxonomy grouping, not a scripted illusion.

**The honest default, and why it's the point, not a gap:** this
environment has zero active providers seeded for any capability, so every
one of the 9 sample needs currently traces to `NO VERIFIED LIVE ROUTE
YET` — CHEW's registry has the capability defined, but refuses to invent a
referral to fill the empty slot. When a route is blocked there, the
Consent and Handoff stages still render, but as "Not reached" — visible,
not hidden, so a visitor can see what *would* happen without CHEW
pretending it already can. This is the same restraint pattern as the
Opportunity Radar, just carried one layer deeper into an actual routing
decision instead of a capability overview.

**Consent is always simulated, and this page never writes anything.**
`lib/capabilityGraph.js` already has `recordConsent()`/`recordRoutingEvent()`
for a real, future authenticated flow — this page calls neither. "Grant
simulated consent" only toggles local UI classes and unlocks the Handoff
stage's display text; nothing is sent, shared, or persisted. The Handoff
stage is permanently labeled "DEMONSTRATION — network routing is not
live. No message is actually sent," regardless of whether a route
resolves, matching the directive's `NETWORK_ROUTING_LIVE=false` intent
without inventing new environment-variable plumbing this repo has no other
use for — the honesty is enforced by the page simply never calling a
write endpoint, not by a flag that could be flipped by mistake.

A "Why this route?" inspector (a real `<dl>`, not a tooltip) explains the
match in plain language for every outcome, success or blocked: capability
match, how many real candidates were considered, whether gate conditions
exist, provider count, jurisdiction when available, and the consent
requirement — no black-box "trust us."

**Verified, not assumed, that the success path actually works:** since the
honest default never reaches Consent/Handoff/Outcome in their "live"
states, seeded one real `network_providers` row, one `jurisdictions` row,
and one `capability_provider_links` row (with real eligibility,
prerequisite, and document-needed text) for `insurance_risk_review` in the
scratch database, then confirmed in the browser that the Gate stage showed
the real conditions, the Provider stage showed the real name/status/
jurisdiction, the Outcome stage read "VERIFIED ROUTE FOUND," clicking
"Grant simulated consent" correctly disabled the button, lit the
connector, and flipped Handoff from "Not reached" to "Proceeding via Warm
email introduction" (the real `contactMethod`), and the inspector reported
the real jurisdiction and provider count — then deleted all three seeded
rows and confirmed the API and page both reverted to the honest zero-state.

Tested all 9 sample needs individually (27 runs: 9 needs × 3 viewport
conditions) at a 1280px desktop viewport, under `prefers-reduced-motion`,
and at a 375px mobile viewport: asserted the exact stage sequence, that
every stage reached `is-visible`, the exact candidate-chip count per
category (0 for single-capability categories, 2 or 3 for shared
categories, exactly 1 marked matched), and the exact honest blocked-state
text for Provider/Consent/Handoff/Outcome — against the live API response
each time, not assumed. Confirmed keyboard `Tab`-then-`Enter` activates a
need button identically to a click. Confirmed the desktop chain scrolls
horizontally (`overflow-x: auto` on a real `<ol>`) and collapses to a
vertical stack with rotated connectors on mobile, mirroring the existing
Domino pattern. Confirmed zero JavaScript console errors throughout.

## The Unlock Room — CHEW's real requirement chain, hand-toggleable (unlock-room.html)

Reuses `/api/intelligence-demo` (same real `requirementSequence`,
`basedOnFacts`, and `capabilityOverview` Domino, Future-Back, and the
Radar already read). Each real requirement renders as a vault door,
seeded open/closed from the real current `met` state. The visitor can
flip any door — a client-only hypothetical toggle, never written back,
never calling `completeAction()`. Doors are real 3D-transformed leaf
panels (`rotateY`) that physically swing open on unlock rather than a
fading line, with a live "N of N barriers open" count and a pathway-fill
bar showing how far the sequence is consecutively clear from the start —
both simple, honest counts derived from the visitor's own toggles, not a
re-implementation of the engine's real prioritization logic (deliberately
not attempted client-side, to avoid the chain drifting from what the
server would actually compute). Where a requirement links to a real
capability, the door shows that capability's real live provider count,
cross-referenced from `capabilityOverview` exactly as the Radar does.

Tested both scenarios across desktop, mobile, and reduced-motion: real
starting lock states matched the live API exactly (home: 1 of 3 open,
`documented_income` only; funding: 0 of 2), toggle correctly flips
classes/`aria-checked`/stat count/pathway fill, keyboard `Enter` toggles
identically to a click, "Reset to CHEW's real current state" restores the
exact original count, zero JS console errors. Caught and fixed a real bug
before shipping: the corridor `<ol>` had no `list-style: none`, so
browser-default numbers rendered as stray "2." "3." markers floating
outside the card edges — fixed, verified by screenshot.

## The Future Room — the real distance between today and the goal (future-room.html)

Reuses `/api/intelligence-demo`'s `requirementSequence`, `basedOnFacts`,
`chosenRequirementKey`, `goalTitle`, and `capabilityOverview` — the same
fields Domino, Future-Back, and the Unlock Room already read. TODAY is a
fixed anchor; the real goal title renders as a destination diamond at the
far end; each real requirement sits between them as a checkpoint —
checkmarked and gold-lit if resolved, dim and outlined if not, and the
real `chosenRequirementKey` rendered larger with a "Start Here" tag. A
baseline bar fills exactly `resolvedCount / totalCount` of the way from
TODAY toward the destination — the literal formula the directive
specified, not a fabricated closeness estimate. Navigation (prev/next,
jump-today, jump-future, a scrubber, arrow keys) only changes which
checkpoint is being inspected; nothing mutates the underlying real state,
unlike the Unlock Room's toggle sandbox.

Signature moment: "Show Me What It Takes" fires a staggered light pulse
from the destination backward through every checkpoint to TODAY, then
lands focus on the real current-focus checkpoint (or the destination
itself, in the honest edge case where every requirement is already
resolved). Reduced motion skips the traveling pulse and jumps straight to
that same landing state — same information, no animation.

Caught and fixed two real bugs before shipping, both from the same root
cause: the segment wrapper `<div>` and its inner `<button>` both carried
`data-index`, so `querySelectorAll('[data-index]')` bound two listeners
per segment. Click was harmlessly idempotent (both handlers targeted the
same index), but ArrowRight/ArrowLeft used relative `focusedIndex + 1`
logic — bubbling from button to wrapper fired both handlers per keypress,
advancing focus by 2 instead of 1. Fixed by binding only to the genuine
interactive control per item. Separately, the mobile layout flips the
progress baseline from horizontal to vertical, but the fill was only ever
driven by `.style.width` — on mobile that inline width kept trying to
apply against a CSS rule expecting height, so the fill would never have
rendered. Fixed by driving both axes from one `--fill-pct` custom
property, read as `width` on desktop and `height` under the mobile media
query. Both caught by testing keyboard navigation and mobile rendering
directly rather than assuming the desktop-verified logic carried over.

Tested both scenarios across desktop, mobile, and reduced-motion: exact
resolved/total counts and baseline fill percentage against the live API,
correct real-goal-title rendering, current-focus checkpoint identity and
capability cross-reference, all navigation controls (buttons, scrubber,
arrow keys) landing on the exact expected index, the pulse landing on the
real current focus, zero JavaScript console errors.

## scenario-engine.js — a shared, reusable scenario-state architecture

A later directive explicitly required this: "Do not build another
isolated sandbox implementation." `scenario-engine.js` extracts the pure,
DOM-free logic behind "what's resolved, what's current focus, what's the
difference between two states" into functions now shared by both the
Unlock Room and the Simulation Room — `deriveState`,
`computeRequirementDelta`, `deriveCapabilityCoverage`,
`computeCapabilityDelta`, and clone helpers for turning real API
responses into the maps these functions consume.

`deriveState`'s "first unmet requirement, by real sequence_order, becomes
current focus" rule is not a guess: it is `lib/intelligenceEngine.js`'s
own documented behavior, copied verbatim in a comment at the top of
`scenario-engine.js` and verified against that file's actual evaluation
loop before being reimplemented client-side. Because the rule has no
hidden inputs beyond real order and a met/unmet flag per requirement,
recomputing it against a hypothetical (toggled) fact set is guaranteed to
match what the server would compute for that same hypothetical set — this
is what makes the Simulation Room's "focus changes" honest rather than
guessed.

Unit-tested directly with `node` before any page used it (no browser
needed for pure functions): a requirement toggle that moves current focus,
one that doesn't, un-resolving an already-met requirement moving focus
backward, the all-resolved edge case, capability coverage math, and the
"no linked capability" case returning `null` rather than a fabricated 0%.
The Unlock Room was then refactored to call `deriveState`/
`cloneResolvedMap` instead of its own inline filtering — its entire
existing Playwright suite was re-run afterward and passed with zero
behavior change, confirming the refactor was safe.

## The Simulation Room — a controlled state laboratory, not a fortune teller (simulation-room.html)

The directive's core distinction — "REALITY = what CHEW actually knows
right now. SIMULATION = what the system would look like if the user
temporarily changed specific assumptions. Never blur those two states." —
is enforced structurally, not just visually: `baselineResolvedMap` and
`baselineAvailabilityMap` are built once from the live API response and
never mutated again for the rest of the session; every toggle mutates a
separate `simResolvedMap`/`simAvailabilityMap` clone. The Reality chamber
renders directly from the baseline maps and has no interactive controls
at all — there is no code path by which touching the Simulation chamber
could change what Reality displays.

**What's honestly simulatable, and why not more:** the real schema has no
branching dependency graph — `transition_requirements` is a strict linear
order (`sequence_order`), and capability availability is informational,
never a gate on requirement resolution in the real engine. Rather than
fabricate a multi-blocker graph the directive's own examples imply
("removes 3 downstream blockers"), the room surfaces the real, more
interesting structural fact: in a strictly linear model, resolving the
*current focus* requirement is the only toggle that ever advances what
CHEW recommends next — resolving any other unmet requirement increases
the resolved count but produces **no downstream movement**, and the room
says so explicitly rather than implying every toggle matters equally. This
is the literal mechanism behind the directive's Impact Comparison feature:
selecting the current-focus requirement and a later one and comparing
them proves, from real data, why order matters — without inventing a
graph that doesn't exist. Capability-availability toggles are a fully
separate, independently honest axis (real per-capability `available`
booleans from `capabilityOverview`), producing a real
`linkedCount`/`availableCount` coverage delta — and explicitly rendering
"impact not currently modeled" rather than a fabricated percentage for any
scenario where no requirement links to a capability (the home scenario,
today).

**Delta Engine**: every toggle re-derives both states through
`scenario-engine.js` and renders a structured before → after: resolved
count, current focus (with an explicit "Unchanged — nothing you've
toggled is currently blocking this focus in CHEW's real order" line when
true), and capability coverage. **Impact Comparison**: picking any two of
the scenario's real baseline-unmet requirements computes each one's
isolated delta (baseline + only that one resolved) independently, so
comparing two candidates never lets a simulation-chamber toggle leak into
the comparison.

**Signature moment**: a bounded pulse fires only on the genuinely affected
nodes — the toggled node itself, plus the old and new current-focus nodes
only if focus actually changed, or the linked requirement nodes when a
capability toggle changes their displayed status. Untouched nodes never
animate. Finite, capped-iteration CSS animation, no continuous loops.

**Mobile**: a Reality/Simulation tab switch below 900px (not a squeezed
two-column layout) — same toggle logic, same Delta Engine, no horizontal
overflow, no perspective effects.

**Truth boundary, always visible**: the Simulation chamber is permanently
labeled "SIMULATION — NOT YOUR CURRENT STATE"; nothing in this page calls
`completeAction()`, `recordConsent()`, or any write endpoint — every
toggle is a client-only map mutation, discarded on reload or "Reset to
Reality."

Tested the full required matrix: partially-resolved baseline (home,
1-of-3), fully unresolved baseline (funding, 0-of-2), a single
non-blocking toggle (confirmed zero focus change), a blocking toggle
(confirmed focus advance), multiple toggles reaching full resolution,
reset restoring the exact original baseline, a capability toggle
confirmed to leave resolved-count untouched (proving the two axes are
independent), keyboard `Enter` parity with click, and a forced
fully-resolved *baseline* edge case (seeded directly in the scratch
database) confirming the Reality chamber, Simulation chamber, and Impact
Comparison all degrade honestly ("Not enough real unresolved requirements
... to compare") rather than breaking — reverted immediately after.
Verified at 1280px desktop, 768px tablet, 375px mobile, and under
`prefers-reduced-motion`, including that narrow viewports require the tab
switch before simulation controls become clickable (not a bug — by
design). Zero JavaScript console errors in every run.

## Wealth World — the Life Map and the capability registry, in one view (wealth-world.html)

Named as the room that would either become "real intelligence underneath
the spectacle" or "a decorative visualization," depending on whether it
reused what already exists. It reuses two already-real, already-shipped
datasets verbatim rather than inventing a third: the Life Map's 8
territories and 13 curated relationship edges (identical data, copied
from `script.js`'s `LIFEMAP_EDGES`), and the capability registry's 9 real
capabilities with live provider counts (identical data to the Opportunity
Radar, fetched from the same `capabilityOverview` field).

**What's genuinely new, and clearly labeled as such:** the grouping
between the two rings. There is no stored relationship between a Life Map
territory and a capability row anywhere in the schema, so
`CAP_TERRITORIES` is CHEW's own editorial pairing (e.g. "Accounting / Tax"
grouped with Capital and Business) — every detail panel that shows this
grouping says explicitly "CHEW's own grouping, not a stored relationship."
Three real capabilities (Event Production, Transportation / Logistics,
Relocation / Storage) don't map cleanly onto any of the 8 financial
territories — rather than force a connection that doesn't exist, they're
rendered in a visually separate row below the map, still real, still
clickable, still showing real live status, just honestly ungrouped.

Selecting a territory highlights its real Life Map connections and the
real capabilities editorially grouped with it; selecting a capability
highlights its live availability state and which territories it's grouped
with. Caught and fixed a real layout bug before shipping: two pairs of
capability satellite nodes (Insurance/Risk Review + Security/Protection,
and Real-Asset Execution + Property Care) were positioned only 20° apart
on the outer ring, close enough that their label text rendered
overlapping and unreadable — fixed by widening the angular separation to
32°, verified by screenshot before and after.

Verified the live-update claim the same way as the Radar: seeded one real
provider and capability link for `accounting_tax` in the scratch database,
confirmed the node visually gained `is-available` styling and its detail
panel reported "1 active provider," then reverted. Tested all 8
territories and all 9 capabilities (6 grouped, 3 ungrouped) individually
across desktop, mobile, and reduced-motion, asserting the exact connected-
territory and connected-capability sets for every one against the real
curated data (not just that something highlighted) — 17 selectable
elements × 3 viewport conditions, all exact-matched. Confirmed keyboard
`Tab`-then-`Enter` activation and zero JavaScript console errors
throughout.

## CHEW Lab — six experiment bays, each honestly labeled (chew-lab.html)

The last named room, and the first page on this site to put a truthful
status word directly on unfinished intelligence rather than only
describing it in this document. Six bays, each carrying one of the
directive's own status words and its own visible "What's real here"
transparency block (Status / Uses / Does not yet use), collapsed by
default and toggleable:

- **Future-Back Planning (Preview)** — not a new build, a condensed live
  view of the real Future Room: fetches the same
  `/api/intelligence-demo` scenario, renders a real resolved/current/
  unresolved dot chain from the real `requirementSequence` and
  `chosenRequirementKey`, and links out to the full room.
- **Economic Weather (Experimental)** — the first time this directive's
  "blocked" item actually ships a real slice instead of staying fully
  blocked. Two of its four gauges are genuinely computed: Readiness is
  the real resolved/total requirement fraction (identical math to
  Future-Back), Risk is the real count of unresolved `constraints` rows
  for this scenario (`recommendation.basedOnConstraints`, already
  computed server-side, never fabricated here). The other two —
  Momentum and Liquidity — render as an honestly dashed gauge reading
  "n/a," because CHEW's schema still has no history-over-time table to
  compute a trend from; the bay's own transparency block says so
  explicitly rather than inventing a plausible-looking number.
- **Parallel Futures, Hidden Leverage, Friction Detection, Conflict
  Detection (Simulation / Research)** — fixed, hand-built illustrative
  sketches with no live data path. Each one's transparency block states
  plainly what schema gap keeps it from being real today (no
  dependency-modeling engine, no asset/relationship data, no action-
  repetition history, no simultaneous-goal modeling), and each uses real
  capability names from the registry only as illustrative labels, never
  as claimed live structure.

A page-level signature moment — "Walk The Floor" — sequentially lights
up all six bays in a staggered sweep (a visual tour of the room, not a
new computation), then settles into a status line stating the real
split: two bays running on real data today, four still fixed research
sketches. Under `prefers-reduced-motion`, the sweep is skipped entirely
and the same status line is set immediately with no stagger.

Tested against a live local PostgreSQL 16 database and a real Chromium/
Playwright session: confirmed all 6 bays render with the exact expected
status vocabulary; confirmed Future-Back's chain and description use
the real fetched resolved/total count and goal title; confirmed the
Economic Weather gauges show a real percent and a real constraint
count while Momentum/Liquidity render exactly `n/a`; confirmed the
transparency toggle opens/closes via both click and keyboard `Enter`
with correct `aria-expanded` state; confirmed the sweep signature
moment fires, animates, and lands on the correct completion text;
confirmed the reduced-motion path sets that same text immediately with
no stagger; confirmed the floor collapses to a single column on a
390px mobile viewport; confirmed zero JavaScript runtime errors across
all of the above (the only console noise was the Google Fonts request
being blocked by the sandboxed test environment — identical, pre-
existing behavior on every other page on this site, not something this
page introduced).

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
    inside a design pass); the Life Map's "evolve" ambition specifically —
    reconfiguring node positions and showing a before/after state once a
    simulated action is taken, which would require real per-subject state
    the public site has no identity system to hold (the Life Map's
    territory-selection interactivity itself is now built — see above —
    but it illuminates curated, editorial relationships, not anything
    wired to a subject's real data); the two Momentum/Liquidity gauges
    inside CHEW Lab's Economic Weather bay specifically (Readiness and
    Risk are now real — see above — but a genuine trend needs a
    history-over-time table that doesn't exist yet); "What Changed,"
    Hidden Leverage, Friction Detection, and Conflict Detection as real
    (rather than fixed-illustrative) experiences (each needs either
    state-over-time tracking or pattern-recognition across a subject's
    history that doesn't exist for the one seeded test subject —
    building these even as "demo" would mean fabricating a history that
    was never seeded, which is different from labeling a single static
    scenario as an example).
  - **Just not built yet, execution-bandwidth only**: Parallel Futures
    specifically (it needs invented hypothetical timeline data with no real
    computed basis, unlike Future-Back — see above, and per direct
    instruction this stays unbuilt until a legitimate scenario-modeling
    layer exists — Impact Comparison, now built in the Simulation Room, is
    the honest, non-fabricated version of this same instinct — CHEW
    Lab's own Parallel Futures bay is a fixed illustrative sketch of the
    same idea, explicitly labeled Simulation, not the real engine),
    sound design, and a bespoke mobile choreography
    beyond the existing responsive breakpoints (CHEW Blind Spot, CHEW
    Domino, the Opportunity Radar, Future-Back, the Network Room, the
    Unlock Room, the Future Room, the Simulation Room, Wealth World, and
    CHEW Lab are no longer on this list — see above, all ten now built).
    None of these need a
    capability this repo
    lacks to build as a
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
