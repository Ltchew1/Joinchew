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

## The Scenario Modeling Foundation — a real, internal-only modeling layer (lib/scenarioModel.js)

The directive after CHEW Lab asked for the opposite move from every
room before it: instead of a new public visual, a real durable data
model underneath the intelligence system, built honestly around this
repo's actual constraint — there is still no real member/identity
system (ARCHITECTURE.md Gap 1). The resolution follows the directive's
own instruction precisely: build the real architecture now, scoped to
the one seeded illustrative subject, and make the identity boundary a
database-enforced fact, not a comment that trusts future authors to
remember it.

**Schema created** — `scenarios` (`db/schema.sql`): `subject_type` is
identity-*ready* (its `CHECK` allows `'illustrative'` and `'member'`),
but a second `CHECK (subject_type <> 'member')` on the same table
actively **blocks** any row from ever being inserted with
`subject_type = 'member'` today. This isn't a code-level gate that a
future caller could route around — it's enforced by Postgres itself,
verified directly: `INSERT ... VALUES ('member', ...)` against the real
schema returns `ERROR: new row for relation "scenarios" violates check
constraint`. The comment beside it names the exact removal condition: "a
real authenticated member identity layer exists." Every other field
(`baseline_snapshot`, `proposed_move`, `assumptions`, `effects`,
`dependencies`, `affected_goals/constraints/opportunities`, `risks`,
`reversibility`, `uncertainty_classification`, `scenario_status`,
`model_version`, `rule_version`, `time_horizon`, timestamps) matches the
directive's own minimum field list — nothing extra was added because it
"sounded advanced." A new `scenario_modeling` feature flag row was added
at status `internal`, identical in spirit to `intelligence_engine`'s
existing gate.

**Reused, not rebuilt:** this was the directive's hardest constraint,
and it holds. `lib/scenarioModel.js` computes every "what would change"
answer by re-running **scenario-engine.js's own
`deriveState()`/`computeRequirementDelta()`** — the exact same pure
functions already reused by the Unlock Room and the Simulation Room —
against a hypothetical in-memory fact override. It never touches
`current_state_facts`. The one small honest refactor this required: the
inline SQL that built `requirementSequence` inside
`api/intelligence-demo.js` is now `lib/intelligenceEngine.js`'s own
exported `getRequirementSequence()`, called by both files — one query
defines "the chain" now, not two that could quietly drift apart.
`api/intelligence-demo.js`'s JSON output was verified byte-identical
before and after this refactor (same live server, same request,
diffed). `lib/capabilityGraph.js`'s `getRoutingRecommendation()` and
`getCapabilityOverview()` are called exactly as they already were
elsewhere — no new read path invented.

**Baseline snapshot** answers "what did CHEW actually know when this was
run?" using only real reads: the real requirement chain and its real
met/unmet state, the real unresolved `constraints` rows, the real
capability-coverage fraction (or `null` when nothing links, never a
fabricated 0%), and the real current recommendation (chosen requirement
+ its real linked capability, if any) — all computed the same way, at
read time, never cached from a stale prior call. `unavailableDataPoints`
explicitly lists four financial dimensions this schema has no field for
at all (income, liquidity, employment history, asset-ownership detail)
— each with `available: false` and a plain reason, rather than silently
omitting them in a way a reader could mistake for "everything is known."

**Effects** are structured per the directive's own list (entity, effect
type, direction, explanation, rule/source, uncertainty class, time
relevance) and computed for the one real slice built this pass —
"resolve one known requirement" — covering requirement state, readiness,
recommendation, linked opportunity, and the dependency chain itself.
Two honesty rules are load-bearing here, both directly reused from
reasoning already established earlier in this build: resolving a
requirement **out of its real sequence order never moves the current
focus** (this chain is strictly linear, not branching — the same real
structural fact the Simulation Room surfaces), and reversibility is
reported as `'unknown'` for every scenario, not a plausible-sounding
guess, because nothing in this schema captures how reversible resolving
any given requirement actually is.

**The first real scenario slice**, run against the real seeded
subject/goal (subject 1, "Buy a first home (example)"): baseline was 1
of 3 real requirements resolved (33%), current focus `credit_score`
(the real 580-vs-620 gap). Modeling "resolve credit_score now" produces:
readiness 1/3 → 2/3 (67%), current focus shifts to
`down_payment_savings_cents` (recommendation *changes* — real, not
staged), and the opportunity effect honestly reports no linked
capability exists for either requirement, before or after (neither row
has a `capability_id` in the real schema). Two companion edge cases were
run and reported honestly rather than dramatized: resolving
`documented_income` (already met) produces **no** readiness or
recommendation change; resolving `down_payment_savings_cents` (the
downstream requirement) out of order **also** produces no recommendation
change — proving the linear-order rule rather than asserting it.

**Parallel Futures MVP** (`compareParallelFutures()`): compares exactly
those three real options against one shared baseline capture, each
persisted as its own real `scenarios` row tagged with a shared
`comparisonGroupKey`, never a second disconnected comparison structure.
No fabricated cost, timing, or probability was added to make the
comparison "look richer" — only readiness, current-focus, and linked-
capability are compared, because those are the only dimensions this
repo can support honestly today.

**Future-Back MVP** (`buildFutureBackTrace()`): the first non-fictional
Future-Back path built on this new foundation specifically — reverses
the real requirement chain into outcome ← required conditions ← missing
conditions ← next available action, reusing the identical baseline
capture with no second engine and no invented date or lifestyle content.

**Staleness**: `getScenario()`/`listScenarios()` compare a stored
scenario's preserved baseline against the real current facts on every
read; if they've diverged, `scenario_status` flips to `'stale'` and that
flip is persisted — but the scenario's stored `effects` are never
silently recomputed. Verified directly: seeded a real fact change
(`credit_score` → 650) against an already-created scenario, confirmed
`scenario_status` flipped to `stale` on the next read, confirmed its
`effects` array was byte-identical before and after the flip, then
reverted the seeded fact.

**API** (`api/scenario-model.js`): `GET ?action=baseline|list|futureBack`,
`GET ?id=`, `POST {action: 'create'|'compareParallelFutures'}` — gated
`internal` exactly like `api/intelligence-recommendation.js`, and every
request is pinned to the one seeded illustrative subject; there is no
caller-supplied `subjectId` parameter anywhere in this file, so there is
no path by which a request could attach a real visitor's identity to a
scenario even by accident.

**Tests performed**: a standalone Node test script exercised
`lib/scenarioModel.js` directly against a live local PostgreSQL 16
database (bypassing HTTP entirely, the same way this repo already tests
other internal-only logic) — baseline preservation, the first real
scenario slice's five effect types, the already-met and downstream-order
edge cases, no-fabrication assertions (no invented income value, no
fake confidence/probability language), model/rule versioning, staleness
flip-and-no-recompute, repeated-modeling consistency (identical inputs →
byte-identical effects), Parallel Futures' 3-way comparison, Future-Back
traversal, and the DB-level `member` block — all passed. Separately,
over real HTTP against the same database: confirmed the endpoint 404s
by default (the `internal` gate actually blocks it, not just in theory);
temporarily flipped the flag to `preview` in the **scratch test
database only** to exercise the full `GET`/`POST` surface end-to-end
(baseline, create, list, compare, future-back, get-by-id), confirmed
identical results to the direct Node tests, then flipped the flag back
to `internal` and confirmed the 404 returned — and deleted the test
scenario rows from the scratch database afterward. The production
`scenario_modeling` flag was never touched and stays `internal`.

**What must change once real member identity exists**: relax exactly
one line — the `CHECK (subject_type <> 'member')` constraint on
`scenarios` — and give `api/scenario-model.js` a real authenticated
`subjectId` instead of the hardcoded illustrative one. Nothing else in
`lib/scenarioModel.js` needs to change: the baseline/effects/versioning
logic already operates per-subject, per-goal: it was simply never given
a second subject to run against.

## Multi-goal Conflict Detection — exactly one real, rule-backed conflict (lib/scenarioModel.js)

The immediate follow-up directive named the risk explicitly: "do not
create fictional cross-goal relationships simply because they make
intuitive sense... build those [1-2 real ones] completely rather than
inventing 20." That instruction is enforced in code, not just followed
by discipline while writing seed data.

**Schema created**: `goal_conflict_rules` (`db/schema.sql`) — a
human-authored row naming exactly two real `goals`, the exact real
`fact_key` they share, a fixed `conflict_type` vocabulary
(`shared_fact`/`shared_resource`/`shared_time`), a plain-language
`mechanism` explaining why they actually compete, and a `certainty`
reusing the same vocabulary as scenario-level uncertainty
(`known`/`deterministic`/`assumption_dependent`/`estimated`/`unknown`).
`scenarios` gained two nullable columns, `related_goal_id` and
`conflict_rule_id` — additive only; every scenario created before this
change, and every single-goal scenario created after it, has both
`NULL` and is otherwise unaffected. This repo's two existing
illustrative goals genuinely share **zero** overlapping requirement
keys (verified directly against the schema before writing any of this)
— so rather than force a connection or silently add a new requirement
row to an existing goal (which would have quietly changed its real
resolved/total counts and broken every already-tested room that reads
them), exactly **one** conflict rule was seeded: both "Buy a first
home" and "Get business funding-ready" structurally depend on the
subject's `documented_income` — a real fact already used by goal A's
first requirement — because mortgage underwriting and business
funding-readiness both genuinely care about verifiable, consistent
income, even though goal B's own transition has no explicit
`documented_income` requirement of its own. No other pair or fact was
seeded, on purpose.

**The refusal is the load-bearing part**: `getConflictRule()` is the
*only* function that can authorize modeling an effect between two
goals, and it only ever returns a match for a pair+fact a human
explicitly declared in advance — there is no inference path, no
similarity heuristic, and no fallback. Verified directly: asking it to
model `credit_score` between the two real goals (a fact that sounds
just as plausible as `documented_income` — both are financial!) throws
`No rule-backed conflict is declared...`; asking about a goal pair with
no rule at all throws the same way; and `createCrossGoalScenario()`
itself refuses before doing any other work, not just the lower-level
lookup function. A refused request persists nothing — verified the
`scenarios` row count is identical before and after a refusal.

**Effects, honestly asymmetric**: when the shared fact IS part of a
goal's own real requirement chain (goal A, home), the exact same
`computeEffects()` already used by single-goal scenarios is reused —
no second effects engine. When it ISN'T (goal B, business), the engine
reports exactly one `qualitative_conflict_note` effect quoting the
rule's own `mechanism` text and `certainty` verbatim, and explicitly
does **not** produce a `readiness` effect for that goal at all — proven
directly in tests (`goal B has NO readiness effect at all`), because
fabricating a number for a goal whose real schema has no requirement
tied to the fact would be exactly the kind of invented precision this
whole build has refused everywhere else.

**A real correctness fix this surfaced**: modeling `documented_income`
becoming `false` (the model of "losing verifiable income," the same
shape as the directive's own "leave employment" example) is a
*regression* — a previously-met requirement becoming unmet — which
`computeEffects()` had never been exercised against before (every prior
scenario only ever modeled resolving a requirement). Its binary
resolved-or-not logic would have mislabeled a regression as "remains
unmet," which is not fabricated but also not what actually happened.
Fixed by distinguishing four real states instead of two
(`requirement_resolved` / `requirement_newly_unmet` /
`requirement_remains_resolved` / `requirement_remains_blocked`) and
adding a matching `readiness_worsens` state alongside
`readiness_improves`/`readiness_unchanged`. Re-verified the entire
existing single-goal test suite still passes unchanged after this fix.

**A genuine finding, not staged**: modeling that regression on the real
seeded data shows CHEW's current focus pulling *backward* — from
`credit_score` (sequence 2, the real prior focus) to `documented_income`
(sequence 1) — the moment the earlier-sequence requirement becomes
unmet again, exactly matching the documented "first unmet by
sequence_order" rule with no special-casing. This wasn't designed in;
it fell out of reusing the real rule against a state that hadn't been
tried before.

**Staleness and versioning are reused, generalized, not reimplemented**:
`checkStaleness()` now compares a cross-goal scenario's *two* preserved
baselines against the real current facts (either goal drifting is
enough to flip `scenario_status` to `stale`); verified directly that
changing goal B's real `bookkeeping_current` fact — a fact that has
nothing to do with goal A — correctly staled a scenario whose primary
`goal_id` is goal A, and that the stored `effects` array stayed
byte-identical across that flip.

**API**: `api/scenario-model.js` gained `GET ?action=listConflictRules`
and `POST {action: 'createCrossGoalScenario', goalAId, goalBId, factKey,
hypotheticalValue, timeHorizon}` — same file, same `scenario_modeling`
`internal` gate, no new feature flag. An undeclared pair/fact correctly
returns `404`, matching how this file already treats "not found."

**Tests performed**: a standalone Node suite exercised the new
functions directly against a live local PostgreSQL 16 database — rule
lookup (both orderings), the refusal path (undeclared fact for a real
pair, an entirely undeclared pair, and refusal from
`createCrossGoalScenario` itself), the one real cross-goal scenario's
full effect set on both sides, the qualitative-note honesty checks
above, cross-goal staleness, and the "no persisted row on refusal"
check — all passed, alongside a full re-run of the pre-existing
single-goal suite. Separately over real HTTP: confirmed the endpoint
404s by default, temporarily flipped `scenario_modeling` to `preview`
in the **scratch test database only** to exercise
`listConflictRules`/`createCrossGoalScenario` end-to-end (confirming
the undeclared-fact request 404s and the declared one returns 201 with
the same asymmetric effect shape as the direct Node tests), flipped the
flag back to `internal`, confirmed the 404 returned again, and deleted
the test scenario rows. The production flag was never touched. Also
caught and fixed, mid-session, an unrelated pre-existing idempotency
gap in `db/seed-intelligence.sql` (no unique constraint on
`transition_requirements`, so repeated re-runs of the seed script had
silently tripled rows in the long-lived scratch database this session
reuses) — reset the scratch database once and re-seeded cleanly; this
is a scratch-test-environment artifact, not a production data issue,
since production seeds once.

**CHEW Lab connection**: the Conflict Detection bay's transparency
block now discloses that CHEW has a real, rule-backed internal engine
that refuses undeclared relationships — while its status stays
`Simulation` and its visual stays the fixed illustrative sketch, since
this public page still isn't wired to the internal endpoint.

**What must change once real member identity exists**: same answer as
the Scenario Modeling Foundation above — a real `subjectId` instead of
the hardcoded illustrative one. `goal_conflict_rules` itself needs no
identity-related change at all, since a conflict rule is declared
between two `goals` rows, not two subjects — the same rule already
generalizes to a real member's own goals once goals can belong to one.

## Parallel Futures — real multi-goal comparison (lib/scenarioModel.js)

The direct payoff of the two builds above: a caller can now compare 2-3
real paths from one shared baseline across two real goals, side by
side, using nothing this repo hasn't already built and tested. No third
comparison engine was written — `compareCrossGoalFutures()` is a thin
orchestrator over three already-real building blocks: the do-nothing
baseline (never persisted, mirrors `compareParallelFutures`'s existing
`leave_unresolved` precedent), the already-tested `createCrossGoalScenario()`
for a declared cross-goal move, and one new function,
`createComparisonMoveScenario()`, for a single-goal move evaluated
inside a two-goal context.

**A refactor first, to keep three call sites from drifting**: the
`scenarios` INSERT statement was duplicated verbatim in `createScenario`
and `createCrossGoalScenario` before this pass — exactly the shape of
duplication that produced this build's one real bug so far (the
`requiredValue`/`required_value` mismatch). Extracted into one
`persistScenario()` function both now call, plus a shared
`evaluateFactOverrideForGoal()` for "does this fact belong to this
goal's own chain, and if not, what's the honest fallback" — reused by
`createCrossGoalScenario`'s two sides and the new comparison move
function alike. Re-ran the entire pre-existing single-goal and
cross-goal test suites after this refactor with zero behavior change
before writing a single line of new comparison logic.

**`createComparisonMoveScenario()`** is the one genuinely new piece,
and it draws a careful, deliberate line the other two building blocks
don't need to: a single-goal move (e.g. "resolve credit_score on the
home goal") is always legitimate on its own goal, so it never refuses
outright the way `createCrossGoalScenario` does. It only reasons about
the *other* goal in the comparison when `getConflictRule()` — the same
sole authorization point as everywhere else in this file — finds a
declared rule covering that exact fact between these two goals.
Verified directly: resolving `credit_score` (no declared rule for it)
inside a comparison against the business-funding goal produces an
explicit `no_declared_relationship` effect on that goal, quoting
neither a number nor the unrelated `documented_income` rule — proving
the comparison doesn't leak one path's authorized relationship into
another path that never earned it.

**The exact three-path comparison this was built to prove**, run
against the real seeded subject:

- **Path A — Preserve documented income.** Never persisted (it *is* the
  baseline). Both goals report `no_change_modeled`.
- **Path B — Remove documented income.** Reuses `createCrossGoalScenario`
  unmodified. Home goal: readiness genuinely worsens 1/3 → 0/3
  (quantified, `deterministic`). Business goal: the real rule-backed
  qualitative note (`assumption_dependent`) — no readiness effect at
  all.
- **Path C — Resolve credit score first.** New
  `createComparisonMoveScenario` path. Home goal: `credit_score`
  genuinely resolves, readiness improves (quantified, `deterministic`).
  Business goal: an explicit `no_declared_relationship` note
  (`unknown`) — CHEW does not invoke the `documented_income` rule here,
  because `credit_score` is a different fact with no rule of its own.

All three paths share one `comparisonGroupKey`; none is ranked. The
returned `comparisonNote` states plainly that CHEW does not pick a
winner because no priority weighting exists for this illustrative
subject — verified directly that no `winner`/`recommendedPath`/`bestPath`
field exists anywhere in the response.

**Refusal is preserved at the comparison level, not just per-function**:
a comparison containing an undeclared `cross_goal_fact_change` path (a
`credit_score` cross-goal claim, which has no rule) throws before
anything is persisted — verified no partial comparison, and no orphaned
scenario rows from the paths that would have succeeded, are left behind.

**Constraints and opportunities, honestly bounded**: per the
directive's own request to show "constraints created/removed" and
"opportunities affected" per path — this schema has no mechanism for a
modeled move to create or resolve a constraint at all, so the
comparison's note says that plainly rather than reporting a fabricated
`0` for every path. Opportunity effects are the real `capabilityGraph.js`-backed
`opportunity` entries already present in each path's `effects` array
(none of this repo's real requirements happen to carry a linked
capability in the current seed data, so every path here reports
"unavailable" honestly — not because the feature doesn't work, but
because that's what's actually seeded).

**API**: `api/scenario-model.js` gained
`POST {action: 'compareCrossGoalFutures', goalAId, goalBId, paths, timeHorizon}`
— same file, same `scenario_modeling` `internal` gate, no new flag.

**Tests performed**: a standalone Node suite covering input validation
(2-3 paths, recognized move types), the full three-path Home/Business
comparison above with every effect type asserted per path, the
no-winner-field guarantee, comparison-level refusal on an undeclared
path, uncertainty-vocabulary discipline across all three paths' effects,
and `createComparisonMoveScenario`'s own `moveGoalId` validation — all
passed on the first real run against a live local PostgreSQL 16
database, alongside a full re-run of both pre-existing suites (86 total
assertions across the three test files, zero failures). Separately over real
HTTP: confirmed the endpoint 404s by default, temporarily flipped
`scenario_modeling` to `preview` in the **scratch test database only**
to run the identical three-path comparison end-to-end (confirmed
byte-identical effect shapes to the direct Node test), flipped the flag
back to `internal`, confirmed the 404 returned again, and deleted the
test scenario rows. The production flag was never touched.

**CHEW Lab connection**: the Parallel Futures bay's "Uses" note, written
speculatively before this engine existed, now describes what actually
exists — a real multi-goal comparison engine that never picks a
winner — while its status stays `Simulation` and its public visual
stays the fixed sketch, unchanged.

**What must change once real member identity exists**: same answer as
the two builds above — a real `subjectId`. Nothing about the comparison
logic itself is subject-specific beyond that.

## The Hidden Leverage Foundation — one real evidence-backed discovery (lib/leverageModel.js)

A deliberately different problem shape from everything above it, built
that way on direct instruction: Scenario Modeling and Conflict Detection
both start from a proposed change and ask what would happen; Hidden
Leverage starts from what's *already real* and asks what's underused.
Forcing it onto the `scenarios` table's baseline/proposed-move/effects
shape would have manufactured a false resemblance between two genuinely
different questions, so it wasn't — `leverage_items` is its own table,
with its own vocabulary, described at length in `db/schema.sql`.

**The hard rule this file exists to enforce**: every leverage item must
trace to real stored evidence — a real fact, a real requirement it
satisfies, a real `goal_conflict_rules` row, or a real capability link.
There is no LLM call anywhere in `lib/leverageModel.js`, no
brainstorming step, and no fallback that invents an asset, relationship,
program, or provider. A detector that can't point to real evidence
returns nothing.

**Schema created**: `leverage_items` — `source_type`/`source_ref` (what
real row this traces to), `leverage_category` (fixed vocabulary:
`reusable_requirement`/`multi_goal_fact`/`dormant_capability`/
`underused_resource`/`duplicate_effort_avoided` — only `multi_goal_fact`
has a real detector this pass), `evidence` (structured JSONB pointers,
never prose alone), `verification_state` (reuses
`current_state_facts.fact_type`'s exact vocabulary rather than inventing
a parallel one), `activation_status` (7-state real vocabulary including
`stale` and `already_activated`), `uncertainty_classification` (adds
`editorial` to the vocabulary `scenarios` uses, per direct instruction,
for a future item built on a declared-but-not-stored mapping — no item
this pass actually uses it). Same identity boundary as `scenarios`: a
`CHECK (subject_type <> 'member')` blocks a `member` row at the database
level, verified directly. A `uniq_leverage_items_evidence` index makes
duplicate discovery structurally impossible, not just discouraged by
application code — verified directly with a raw duplicate `INSERT`,
which the database itself rejected.

**Two real detectors, one that fires and one that honestly doesn't**:

- `discoverMultiGoalFactLeverage()` finds the one real leverage case
  this repo's seed data supports: `documented_income` is a real,
  already-`true` fact that satisfies the home goal's real "Documented
  income" requirement, and the real `goal_conflict_rules` row Conflict
  Detection built declares that same fact also matters to the
  business-funding goal. This is the exact "shared fact reuse" case the
  directive named as the preferred first proof, and it reuses Conflict
  Detection's own `listConflictRulesForGoal()` as its evidence source —
  the declared-relationship infrastructure built for one feature turned
  out to be exactly the evidence layer the next one needed. It also
  runs a second, more literal check — a fact_key appearing verbatim in
  more than one goal's own chain, no declared rule needed at all — which
  is a real, exercised code path that currently and correctly finds
  nothing, because no fact_key repeats across this repo's two seeded
  goals. Proven empty by test, not assumed empty.
- `discoverDormantCapabilityLeverage()` was built to prove the opposite
  case: this repo's one real requirement→capability link
  (`bookkeeping_current` → `accounting_tax`) is correctly recognized as
  **not** dormant, because a `capability_id` link is the exact mechanism
  the existing Opportunity Engine wiring already uses to actively
  surface it — calling it "dormant" would have misrepresented something
  already connected. This detector currently returns empty for every
  real goal, on purpose: this schema has no way to declare "relevant but
  unconnected" without an editorial or rule-based mapping it doesn't
  have yet, and the directive was explicit that guessing from category
  names or topical similarity is exactly the kind of fabrication to
  avoid.

**Two real bugs found and fixed by manual HTTP verification, after the
Node test suite already passed clean** — worth naming because neither
would have been caught by unit tests alone:

1. Postgres's `jsonb` column type does not preserve object key
   insertion order; it canonicalizes on write. The first version of the
   staleness check compared `JSON.stringify(existingEvidence)` against a
   freshly-built JS object — two representations of *identical* data
   that differed only in key order, so every second discovery call
   spuriously marked the just-created item stale. Fixed with a
   `stableStringify()` that sorts keys recursively before comparing.
2. The original discovery loop only ever revisited a fact when it
   *currently* satisfied its own requirement — if the fact stopped
   satisfying it, the loop simply skipped it and never touched the
   already-stored item at all, leaving a now-untrue leverage item
   looking exactly as fresh as ever. Fixed with an explicit staleness
   sweep: any previously-discovered fact-sourced item not re-confirmed
   in the current pass is marked `stale`, without its description or
   evidence ever being rewritten.

Both were caught specifically because a live HTTP smoke test against
the running server was run *in addition to* the Node suite — the Node
suite's own dev-server process had cached the pre-fix module in memory
across edits, which is itself the reason the manual check mattered: a
fix isn't verified until it's exercised through a freshly restarted
process, not just a fresh require() in a short-lived test script.

**API**: `api/leverage-model.js` — `GET ?action=discover|listActive|
listAll`, `GET ?id=`, `POST {action:'activate', id}` — gated `internal`
via a new `hidden_leverage_discovery` flag, same pattern as
`scenario_modeling`. This endpoint IS the "one small inspectable
internal view" the directive asked for instead of a built page — no
HTML/CSS/JS was written for Hidden Leverage this pass, on purpose,
per direct instruction not to build a large page before the engine
exists.

**Tests performed**: a standalone Node suite (31 assertions) covering
real discovery from explicit shared fact, multi-goal reuse, no leverage
when a real-and-met requirement has no declared rule (seeded
`down_payment_savings_cents` as met, confirmed no item was created for
it, reverted), no fabricated resource (every evidence field checked
non-null and real), no duplicate leverage item, already-activated
suppression, stale evidence (both the "evidence changed" and "evidence
disappeared" cases), unsupported source type refusal with zero
persistence, editorial-vs-deterministic vocabulary distinction, the
real-capability-correctly-not-dormant case, unknown/nonexistent-subject
handling, and consistent repeated discovery — all passed, alongside a
full re-run of all three pre-existing suites together (117 total
assertions across the four test files, zero failures). Separately over real
HTTP, against a freshly restarted server: confirmed the endpoint 404s
by default, temporarily flipped the flag to `preview` in the **scratch
test database only**, ran `discover` three times confirming the same
item id and a status that never spuriously staled, exercised
`listAll`/`activate`/`listActive` end-to-end (confirmed an activated
item disappears from the active listing), flipped the flag back to
`internal`, confirmed the 404 returned, and deleted the test row. The
production flag was never touched.

**What remains unavailable**: `dormant_capability` and
`underused_resource`/`duplicate_effort_avoided` as populated
categories — each needs either an editorial/rule-based
capability-relevance mapping or a real document/credential/relationship
data source this schema doesn't have yet (see db/schema.sql's comment —
`document`, `credential`, `relationship`/`provider`, and
`program`/`benefit` source types were explicitly not added, per direct
instruction, because none has real backing data in this repo today).

**What was deliberately not inferred**: any relationship between two
goals beyond what `goal_conflict_rules` already declares; any capability
as "dormant" without a real unlinked-but-relevant mapping; any second
leverage case invented for visual richness once the one real case was
found — the directive was explicit that one real case is enough, and it
was treated as enough.

**CHEW Lab connection**: the Hidden Leverage bay's status moved from
`Research` to `Experimental`, its "Uses" note now describes the one real
discovered item by name, and its visual changed from a dashed
placeholder to a solid gold fact-node branching to two real goals —
while the bay itself still shows a fixed public sketch, since it isn't
wired to the internal engine, exactly as instructed.

**Next highest-leverage extension**: a `document` or `credential` source
type the moment this repo gains a real document/credential object to
detect from — until then, broadening `dormant_capability` via an
explicit, human-authored (not inferred) capability-relevance mapping
table is the next honest step, mirroring exactly how
`goal_conflict_rules` made multi-goal reuse provable.

## Dormant Capability — the real extension, exactly as scoped (lib/leverageModel.js)

Built directly on the "next highest-leverage extension" named above:
`capability_relevance_rules`, the explicit human-authored mapping layer
that lets `discoverDormantCapabilityLeverage()` stop being a permanently-empty
stub and become a real detector, without loosening the refusal
discipline that governs every other detector in this file.

**Schema created**: `capability_relevance_rules` — `source_type`
(`goal`/`requirement`/`fact`, polymorphic `source_ref` like
`leverage_items` already uses) + a real `capability_id` foreign key,
`relationship_type` (fixed vocabulary, only `supports_goal_execution`
used this pass), `mechanism`, `certainty` (reuses `goal_conflict_rules`'
exact vocabulary — no `editorial` here, because a row in this table is
always a real, explicit, intentionally-authored rule, not a loose
grouping), `jurisdiction_id` (nullable), `active`, `authored_by`
(real provenance text), timestamps. A `uniq_capability_relevance_rules`
index makes duplicate rules structurally impossible.

**The one honest rule this repo's registry actually supports**: every
one of the 9 real seeded capabilities' own stored `description` text
was checked directly against both seeded goals before writing anything.
Only one held up without stretching: `real_asset_execution` ("Execution
support for property and other real-asset transactions") is genuinely,
directly on-topic for "Buy a first home" — a real-asset transaction, by
definition. `accounting_tax` is already linked via `bookkeeping_current`
and therefore already engaged, not eligible. Every other capability
(insurance, digital infrastructure, event production, security,
property care, transportation, relocation) has no defensible,
non-speculative connection to either seeded goal. This is goal-level
relevance (`source_type = 'goal'`), not forced onto any single
requirement, because the capability supports executing the transaction
itself, not any one prerequisite toward it.

**The full AND-chain, exactly as specified**: capability exists + an
explicit `capability_relevance_rules` row authorizes it (the sole
authorization point, no similarity heuristic) + the capability is
CURRENTLY available (a real live provider — `activeProviderCount > 0`,
the identical signal the Opportunity Radar/Network Room/Wealth World
already use, never softened to "exists in the registry") + the subject
has a relevant active need (the goal is real and active) + the
capability is NOT already engaged (no real `transition_requirements.capability_id`
link to it) = dormant. Every leg is a real, live read — none hardcoded.

**The load-bearing finding**: `network_providers` is permanently empty
across this entire repo (re-confirmed directly this pass, not assumed)
— every real capability's live `available` flag is `false` today,
which means the "currently available" leg of the chain can never
honestly evaluate true in the current production state, regardless of
how many correct relevance rules exist. So the honest, correct output
of Dormant Capability discovery today is **zero** — not because the
architecture doesn't work, but because there is no real provider
anywhere yet. Proven, not asserted: seeded one real provider + capability
link in the scratch test database, confirmed the exact same rule
correctly produced a dormant item with the real live provider count in
its evidence, then reverted the seed and confirmed the item flipped to
`stale` — the honest permanent state — rather than being silently
deleted or left looking falsely current.

**"Dormant means underused, not merely relevant," enforced structurally**:
`accounting_tax` has no relevance rule at all, on purpose, specifically
because it's already engaged — there was never a temptation to write a
rule for it and then filter it out at query time; the honest move was
to never author that rule in the first place, since a real declared
relationship for an already-engaged capability would be true but
useless. Separately verified in tests that even with a rule and a live
provider present, an already-engaged capability is correctly excluded.

**A real, named schema gap**: `routing_events`/`routing_consents` exist
in this schema but are scoped to the separate `applications` admissions
pipeline, not to `intel_subjects` — there is no real join path from the
illustrative subject to a routing/handoff record. The only real
per-subject "already engaged" signal this schema can check is the
`transition_requirements.capability_id` link, and that is exactly what
this detector checks — documented here rather than silently treated as
a complete handoff-history check.

**Two real, unrelated bugs found and fixed while building this**, both
in the *scratch test database's seed idempotency*, not in this
feature's own logic — but both were actively corrupting test results
until fixed:
1. `transition_requirements`' existing `INSERT ... ON CONFLICT DO
   NOTHING` clauses had no matching unique constraint to target, making
   the clause a silent no-op — repeated `psql -f db/seed-intelligence.sql`
   runs across this session had silently tripled some rows. Fixed with
   a real `uniq_transition_requirements` unique index, which makes the
   *existing* `ON CONFLICT` clauses work as originally intended — no
   change to the INSERT statements themselves.
2. `goals`, `current_state_facts`, and `constraints` had no idempotency
   guard of any kind. Added explicit `WHERE NOT EXISTS` guards to each.
   Verified by running `db/seed-intelligence.sql` three times in a row
   against a freshly truncated database and confirming identical row
   counts (2 goals, 3 facts, 5 requirements, 1 constraint, 1 conflict
   rule, 1 relevance rule) every time. This class of scratch-environment
   pollution — which had already required a manual database reset twice
   earlier in this session — should not recur.

**API**: reuses `api/leverage-model.js` and the existing
`hidden_leverage_discovery` flag unchanged — `dormant_capability` items
appear in the same `discover`/`listActive`/`listAll` responses
alongside `multi_goal_fact` items, no new endpoint needed.

**Tests performed**: a standalone Node suite (21 assertions) — the
empty-state proof (real rule, zero real providers, honestly zero
dormant items), the seed-and-reveal proof (one real provider makes
exactly one real dormant item appear, with the real provider count in
its evidence), the already-engaged exclusion proof, the revert-to-stale
proof (never silently deleted, description never rewritten), and
consistent repeated discovery — all passed, alongside a full re-run of
all four pre-existing suites together (138 total assertions across the
five test files, zero failures) on the now-idempotent database.
Separately over real HTTP, against a freshly restarted server this
time (learning directly from Hidden Leverage's own module-cache lesson):
confirmed the endpoint 404s by default, flipped `hidden_leverage_discovery`
to `preview` in the **scratch test database only**, confirmed `discover`
correctly showed nothing dormant, seeded one real provider directly via
SQL, confirmed the exact same request now showed the dormant item live
with no server restart needed (proving the discovery logic itself,
not just a cached response), reverted the provider, confirmed the item
flipped to stale over HTTP too, flipped the flag back to `internal`,
confirmed the 404 returned, and deleted the test rows. The production
flag was never touched.

**CHEW Lab connection**: the Hidden Leverage bay's "Uses" list now
states plainly that Dormant Capability detection is real, that it
currently and correctly finds nothing, and exactly why — rather than
implying either that nothing was built or that something is live when
it isn't.

**What remains unavailable**: `dormant_capability` will keep honestly
returning empty in production until a real capability provider is
seeded — that's an operational/business decision (onboarding a real
provider), not a code gap. `underused_resource` and
`duplicate_effort_avoided` remain unimplemented, same as before.

**What was deliberately not inferred**: a relevance rule for any of the
8 capabilities whose descriptions don't genuinely match either seeded
goal; a second relevance rule invented for visual richness; any
"already engaged" signal from `routing_events`/`routing_consents`,
since no real join path to the illustrative subject exists for them.

## Economic Weather — the historical-state foundation (lib/weatherModel.js)

Answers a third, genuinely distinct question from the other two internal
intelligence foundations in this repo: not "what would change if I moved
this fact?" (Scenario Modeling) and not "what already exists that's
underused?" (Hidden Leverage), but "what did CHEW actually observe, and
how has it genuinely changed since the last time it looked?" Built the
historical truth first, exactly as directed, before touching any visual.

**The audit, done before any schema was written**: every field
`state_snapshots` stores was checked against real, already-tested code —
readiness numerator/denominator, resolved/unresolved requirement counts,
and current focus all come straight from `lib/scenarioModel.js`'s
`buildBaselineSnapshot()`, reused verbatim rather than recomputed a second
way; unresolved constraint count is the real `constraintState` array that
same function already returns; linked/active opportunity count is the
real `capabilityCoverage` it derives via `scenario-engine.js`, `null`
rather than a fabricated `0` when nothing links; capability availability
count is `lib/capabilityGraph.js`'s real, live, site-wide
`getCapabilityOverview()`. Liquidity, income, credit trend, employment
stability, net worth, asset growth, spending, debt, cash runway, and
market exposure were all checked and confirmed absent from this schema —
none are estimated from unrelated fields; all ten are named explicitly in
`UNAVAILABLE_SIGNALS` rather than silently omitted.

**Schema created**: `state_snapshots` — `subject_type`/`subject_ref` (the
same identity-boundary pattern as `scenarios`/`leverage_items`, a second
`CHECK (subject_type <> 'member')` actively blocking a real person's row
at the database level, re-verified directly this pass with a raw INSERT
that correctly errors), `goal_id`, `observed_at`, `snapshot_reason`
(8-value fixed vocabulary), the readiness/requirement/constraint/
capability counts above, `current_focus_requirement_key` +
`current_focus_action`, a `state_fingerprint`, the `raw_state_payload`,
and `source_version`/`rule_version`. Deliberately **not** the `scenarios`
table — a snapshot is what CHEW observed; a scenario is what CHEW is
asked to imagine. `newly_unlocked_opportunity_count` was deliberately left
out as a column — it's inherently comparative, so it's computed at
`buildEconomicWeather()` time from two real rows instead of stored
redundantly on one.

**Deduplication, by real fingerprint, not by a DB constraint**: a
`state_fingerprint` is a SHA-256 hash over an explicit allowlist of the
ten fields that make up meaningful state — deliberately excluding
`observed_at`, `snapshot_reason`, `created_at`, and the raw payload
(volatile metadata, not state). `captureSnapshot()` compares the real
current state's fingerprint against the most recent real row for that
subject/goal; an identical fingerprint persists nothing and returns the
existing row (`wasNew: false`) instead of a duplicate. This is a
no-consecutive-duplicates rule, not global uniqueness on purpose — the
same real state legitimately recurring later (e.g. after a reverted test
fact) still gets its own row when something material changes again. A
shared `stableStringify()` (sorting object keys before hashing, so a
jsonb-round-tripped row compares equal to a freshly built JS object — the
exact bug class found in Hidden Leverage's evidence dedup) was extracted
into `lib/util.js` so both features reuse one implementation.

**The first real before/after proof, run against live Postgres**: for
this repo's one illustrative home-purchase scenario, starting from
readiness 1/3 with 2 unresolved requirements and current focus
`credit_score` — raising the real `credit_score` fact to satisfy its
requirement, and separately, honestly, resolving the real
credit-utilization constraint tied to that same underlying fact (not
conflating the schema's genuinely separate "requirement" and "constraint"
concepts just to match the directive's example sentence) — CHEW correctly
said, using only real stored state:

> "Readiness improved since the last observation (33% → 67%)."
> "Constraint Pressure eased since the last observation (1 unresolved → 0 unresolved)."
> "Priority shifted from "credit_score" to "down_payment_savings_cents"."

— while simultaneously listing all ten unavailable signals (Liquidity,
Income Stability, …) as `unavailable`, each with its own honest reason,
never a guessed trend.

**Five real signals, never a collapsed score**: Readiness, Constraint
Pressure, Opportunity Access (`unavailable` rather than a fabricated
number when a goal's chain links to no capability at all — proven for
both the home goal, which has none, and the business goal, which links to
`accounting_tax`), Priority/Focus (categorical — `unchanged`/`shifted`,
never a numeric trend), and Capability Access (the real site-wide
provider-availability count, a genuinely different signal than the
goal-scoped Opportunity Access above — same "opportunity vs. capability"
distinction Dormant Capability already established). No "CHEW Score" of
any kind exists anywhere in this file.

**Trend discipline, enforced by code structure, not convention**: 0 prior
comparable snapshots → `current_state_only`, no comparison stated at all;
1 prior snapshot → `change_since_last_observation`, a plain before/after
delta, explicitly never called a trend; 2+ prior snapshots →
`improving`/`worsening`/`stable`/`mixed`, classified from the real full
ordered sequence of consecutive deltas (constraint pressure's deltas
inverted first, since fewer unresolved is the improvement direction) —
never a fabricated momentum score from a single comparison. Directly
tested: a dedicated 3-point up-then-down sequence correctly classifies as
`mixed`, not a falsely confident "improving" or "worsening."

**History vs. Scenario, kept structurally separate, not just by
intention**: `lib/weatherModel.js` imports only `buildBaselineSnapshot()`
from `scenarioModel.js` — a pure real-facts read — and never imports
`createScenario`/`createCrossGoalScenario`/`compareCrossGoalFutures`, and
never queries the `scenarios` table at all. Directly tested: creating a
real hypothetical hourly-rate scenario mid-test produced zero new
`state_snapshots` rows, and the latest real snapshot still reflected the
unmet real fact, not the scenario's hypothetical resolved one. "A
simulated improvement must not appear as actual progress," verified, not
just documented.

**Staleness discipline**: `getEconomicWeather()` always calls
`captureSnapshot()` first — real current state is captured (or deduped
against) before Weather is ever built, so a caller can never see Weather
computed from a snapshot that's already older than what CHEW can prove
right now. Directly tested: calling it with no prior manual snapshot
still returns Weather built from the freshest real state.

**API**: `api/weather-model.js` — `GET ?action=current` (capture/dedupe +
full Weather), `?action=snapshots` (real chronological history),
`?action=latest` (most recent snapshot, no new capture) — gated behind
the new `economic_weather_foundation` flag (`internal`, same identity
boundary as `scenario_modeling`/`hidden_leverage_discovery`), pinned to
`ILLUSTRATIVE_SUBJECT_ID`, never accepting a caller-supplied subject.

**Tests performed**: a standalone Node suite (43 assertions) — first
snapshot forced to `initial_baseline`, identical-state dedup, fingerprint
stability, the exact directive proof sentences above, insufficient-history
(no fake trend language with one snapshot), a dedicated readiness-decline
sequence, the isolated 3-point mixed-trend sequence, opportunity access
`unavailable` for the home goal vs. real expand/contract for the business
goal (seed-provider-and-revert, same proof pattern as Dormant Capability),
all ten unavailable signals present with real reasons, the
history-vs-scenario separation proof, the staleness proof, refusal of a
legal-but-unimplemented snapshot reason (`barrier_resolved`) and of an
entirely invalid one, and the DB-level identity-boundary CHECK — all
passed, alongside a full fresh-process re-run of all six intelligence test
files together (181 total assertions: 37 scenario + 29 conflict + 20
parallel-futures + 31 leverage + 21 dormant-capability + 43 weather, zero
failures) confirming no cross-feature regression. Separately verified over
real HTTP against a freshly restarted server (the module-cache lesson
from Hidden Leverage, re-applied deliberately again): confirmed the
endpoint 404s by default in the scratch database, flipped the flag to
`preview` there only, confirmed `action=current` returned real
initial-baseline signals, applied the same real fact + constraint change
over HTTP and confirmed the identical directive-proof sentences came back,
reverted the test rows, flipped the flag back, confirmed the 404 returned.
The production flag was never touched.

**One real test-authoring bug found and fixed — not a product bug**: two
early assertions expected simple 2-point "declined"/"contracted" language
at a point in the test sequence where 3+ real snapshots already existed,
so `classifyTrend()` correctly returned `mixed` (the honest full-sequence
classification) instead. Fixed by restructuring the test file with
explicit `DELETE FROM state_snapshots WHERE goal_id = $1` resets, isolating
each phase so its precondition actually matched what it was trying to
prove. `lib/weatherModel.js` itself needed no change.

**CHEW Lab connection**: the Economic Weather bay's two live gauges
(Readiness, relabeled Constraint Pressure) are unchanged — still real,
still wired to the public `intelligence-demo` endpoint. Its transparency
copy now discloses the real internal historical engine, quotes the exact
before/after proof, and names all ten still-unavailable signals — the bay
itself stays a fixed public sketch, not wired to the internal engine,
gated internal-only pending real member identity, same as every other
internal foundation in this file.

**What remains unavailable**: all ten named signals (Liquidity, Income
Stability, Net Worth Trend, Asset Growth, Spending Pressure, Debt Trend,
Employment Stability, Cash Runway, Credit Trend, Market Exposure) stay
honestly absent until this schema actually stores that data — never
estimated in the meantime. Snapshot capture is not yet triggered
automatically by real portal events (`barrier_resolved`,
`recommendation_changed`, `opportunity_unlocked` are legal schema values
with no real trigger wired yet — deliberately refused if requested rather
than fabricated); that wiring belongs with a real Global Portal State
Layer, which doesn't exist yet.

**What was deliberately not inferred**: a "momentum" or "trajectory" word
anywhere a real trend classification wasn't warranted; any weather
metaphor implying emotional or financial judgment (storm/sunny/dangerous);
a second, richer atmospheric visual for CHEW Lab, which the directive
itself named as future work, not required this pass; any value for a
signal this schema has no data for.

**Next highest-leverage extension, per the user's own stated order**:
Friction Detection — CHEW Lab's Bay 05 is currently a fixed "Research"
sketch describing a person repeatedly starting and abandoning the same
requirement, a pattern not yet tracked anywhere real.

## Friction Detection — the historical-pattern foundation (lib/frictionModel.js)

Answers a fourth, genuinely distinct question from the other internal
foundations in this repo: not "what's the current condition and how has
it changed?" (Economic Weather), but "does the real history show the
SAME structural blocker recurring, not just existing once?" Built
directly on Economic Weather's own historical truth — this removed the
exact blocker the directive named, and no new history table was needed.

**Core boundary, enforced structurally, not just documented**: a
constraint is something blocking progress *now*; a friction result is a
*pattern* across at least two real, comparable observations. This file
never calls one unresolved requirement "friction" on its own — every one
of its four friction types has a hard 2-observation minimum before it
will use the word at all, verified directly in tests.

**No new schema.** `lib/frictionModel.js` reads only real rows via
`weatherModel.listSnapshots()` — the identical real historical source of
truth Economic Weather already established. It never queries the
`scenarios` table and never imports `createScenario`/
`compareCrossGoalFutures`, for the same reason `weatherModel.js` itself
refuses to let modeled state leak into real history. Nothing is
persisted: every friction result is a pure derived computation over
snapshots that already exist for another honest reason, re-derived fresh
on every call rather than cached in a `friction_items` table that could
drift from the real history it's supposed to explain.

**Four real friction types, deliberately not five**: `persistent_requirement`
(a requirement stays unresolved across multiple real observations),
`repeated_focus` (CHEW's real current-focus key stays the same across
multiple real observations with no different requirement taking its
place), `readiness_stall` (the real readiness fraction doesn't move
across multiple real observations even though something else genuinely
changed to trigger a new snapshot), and `recurring_requirement` (a
requirement that resolved and then genuinely became unmet again — a real
regression, never inferred from a single before/after pair). A fifth
type, `persistent_opportunity_block`, was deliberately **not** built:
the real per-snapshot `capabilityCoverage` payload only stores counts
(linked/available), not the specific documented blocking condition the
directive required before this type could fire honestly — building it
from counts alone would mean guessing a cause this schema doesn't
actually store yet. Documented here rather than shipped as a shallow
approximation.

**persistent_requirement vs. repeated_focus, proven to genuinely
diverge, not just conceptually separate**: because CHEW's current focus
is always the *earliest-ordered* real unmet requirement (not merely "an"
unmet one), a later requirement can remain persistently unresolved
without ever being the current focus, if an earlier requirement
regresses and reclaims it. Proven directly: in the real test sequence,
`down_payment_savings_cents` was `persistent_requirement`-active for 4
real observations while never once qualifying for `repeated_focus`,
because `credit_score` kept reclaiming the current-focus slot every time
it regressed.

**Minimum evidence threshold, exactly as specified**: 1 real observation
→ no friction claimed at all; 2 real comparable observations → severity
`persistent`; 3+ → severity `repeated` (recurring_requirement uses its
own `recurring` severity, reserved for an actually observed regression).
Material-observation discipline is inherited directly from Economic
Weather's own snapshot deduplication, then defensively re-verified inside
this file's own `materialSnapshots()` rather than trusting a caller's
array — duplicate/no-change snapshots can never inflate an observation
count here.

**The first real proof, run against live Postgres**: starting from the
real seed baseline (credit_score 580, unmet; the real credit-utilization
constraint unresolved), toggling *only* that real constraint's
`is_resolved` flag (never touching credit_score) forced two further
real, materially distinct snapshots while credit_score stayed unresolved
and stayed the current focus the whole time. CHEW correctly said, using
only real stored history:

> "Credit score" has remained unresolved across 3 meaningful observations (within the same observed day).
> "Credit score" has remained CHEW's current focus across 3 meaningful observations with no different requirement taking its place (within the same observed day).
> Readiness has remained at 1/3 (33%) across 3 meaningful observations, even though the state changed enough elsewhere to record a new one each time (within the same observed day).

— three of the four real friction types, from one honest sequence, using
only a real constraint toggle as the directive's own "another material
state changes elsewhere" mechanism.

**The stronger second proof — resolution, then a real regression**:
raising credit_score to 650 correctly moved that same `persistent_requirement`
result to `currentStatus: 'resolved'` ("… remained unresolved across 3
meaningful observations …, then resolved") rather than deleting it
silently, while `down_payment_savings_cents` (never actually resolved)
kept growing its own real count. Dropping credit_score back to 580 then
correctly fired `recurring_requirement` — and *only* that type, never a
second, contradictory `persistent_requirement` for the same key at the
same time:

> "Credit score" was resolved and later became unresolved again — a real regression observed 2 separate times across 5 meaningful observations (within the same observed day). CHEW sees the pattern. CHEW does not know why it regressed.

**No psychology, enforced as a real invariant, not a style guideline**:
every friction result's `explanation` and `whatChewDoesNotKnow` fields
were scanned in tests for procrastination/avoidance/motivation/fear/
distraction language after every real state change in the test sequence
— none ever appeared. Every explanation this engine produces ends by
naming what CHEW does *not* know, not just what it does.

**Missing data vs. real friction, resolved honestly, with a named
limitation**: `requirementMetAt()` returns `null` (never `false`) for a
requirement key absent from a snapshot's real `requirementState` — an
unknown observation is skipped entirely when building that requirement's
timeline, never counted toward or against a pattern. A real, separately
named architectural gap: this schema's `evaluateRequirement()` itself
returns `met: false` for a genuinely missing fact with no distinct
"unknown" state (see `lib/intelligenceEngine.js`) — so a requirement with
no fact on file at all (like `down_payment_savings_cents` in this repo's
own seed data) is currently indistinguishable, at the boolean-`met`
layer, from one that was checked and failed. This file cannot fix that
without restructuring the core intelligence engine, so it's documented
here rather than silently pretended away — and in the one real case this
repo has, the distinction happens not to matter, since every requirement
this repo's seed data actually evaluates is either genuinely recorded or
genuinely absent for a real, known reason.

**Waiting conditions vs. real friction, documented as a real limitation,
not solved**: `isKnownWaitingCondition()` exists as an architectural hook
and is tested directly, but it always returns `false` today — this
schema stores no seasoning-period, eligibility-date, or scheduled-review
field anywhere `transition_requirements` could be checked against. A
future pass with real waiting-period data can wire real logic into this
exact function without restructuring the engine; nothing here fabricates
a distinction the schema cannot support.

**User choice vs. real friction, the one signal this schema actually
supports**: `goals.status` (`active`/`completed`/`abandoned`) is the
only real proxy for "the subject deliberately stopped pursuing this" —
there is no separate "paused" status. `getFrictionForGoal()` checks this
directly and returns `skipped: true` with an explicit real reason for any
goal that isn't `active`, rather than reporting friction for a goal the
subject may have abandoned on purpose. Documented rather than pretending
this schema can tell a deliberate pause apart from abandonment.

**API**: `api/friction-model.js` — `GET ?goalId=1` returns
`{ active, resolved, skipped, skippedReason, materialObservationCount }`
— gated behind the new `friction_detection` flag (`internal`, same
identity boundary as `scenario_modeling`/`hidden_leverage_discovery`/
`economic_weather_foundation`), pinned to `ILLUSTRATIVE_SUBJECT_ID`.

**Tests performed**: a standalone Node suite (38 assertions) — the
1-observation/no-friction floor, dedup of an identical re-capture, the
exact 2-observation and 3-observation directive proofs above with real
evidence-id cross-checks, the resolution transition, the real-regression
proof with the persistent/recurring mutual-exclusion check, the
persistent_requirement-vs-repeated_focus divergence proof, scenario-state
exclusion (creating a real hypothetical Scenario mid-test produced zero
change to friction results), deterministic repeated output (two calls
with no state change produce byte-identical results), the unknown-vs-false
unit check, the waiting-condition no-op hook, the goal-status skip and
resume, refusal of a nonexistent goal, and the DB-level identity-boundary
CHECK — all passed, alongside a full fresh-process re-run of all seven
intelligence test files together (219 total assertions: 37 scenario + 29
conflict + 20 parallel-futures + 31 leverage + 21 dormant-capability + 43
weather + 38 friction, zero failures). Separately verified over real HTTP
against a freshly restarted server: confirmed the endpoint 404s by
default, flipped both `friction_detection` and `economic_weather_foundation`
to `preview` in the scratch database only, replayed the entire real proof
sequence above one HTTP call at a time (toggling the real constraint,
then credit_score) with matching results confirmed at every step,
reverted every scratch row and both flags, confirmed the 404s returned.
The production flags were never touched.

**CHEW Lab connection**: Bay 05 moves from **Research** ("a fictional
example… CHEW doesn't yet track") to **Experimental**, matching Hidden
Leverage's and Economic Weather's own promotion pattern — its
transparency panel now discloses the real engine, the real proof
sentences, and the two named limitations (missing-data ambiguity,
no waiting-period data) rather than claiming nothing was built. The
bay's own visual stays a fixed illustrative sketch (three timeline points
sharing one real blocker), not wired to the internal engine — the
directive's own richer "everything else dims" visual treatment is
explicitly future work, not required this pass. The CHEW Lab intro copy
and floor-sweep status text, both stale since before this session's run
of internal-engine bay promotions, were also corrected to stop claiming
the remaining bays are "fictional… research sketches" when several now
honestly disclose a real internal engine behind a fixed sketch.

**What remains unavailable**: `persistent_opportunity_block` stays
unbuilt until a snapshot can store the actual blocking condition, not
just a count. No cross-feature wiring to Hidden Leverage ("persistent
friction exists + hidden leverage can help address it") or to What
Changed ("one important thing still hasn't moved") — the directive asked
only that the architecture stay compatible, not that the connection be
built, and every friction result's flat, JSON-serializable shape
(`goalId`, `sourceRequirementKey`, real snapshot `evidence`) is exactly
that: nothing here needed inventing to make a future join possible later.
No automatic snapshot-to-CHEW-Move cross-check ("your current CHEW Move
addresses this friction") — deferred for the same reason.

**What was deliberately not inferred**: any word implying a human cause
(procrastination, avoidance, motivation, fear, distraction) anywhere a
friction result's own explanation appears; a "friction score" of any
kind; a waiting-period distinction this schema cannot support; a
`persistent_opportunity_block` type from counts alone; a second
`state_snapshots`-shaped table just for this feature.

## Recommendation purity + canonical derivation (lib/intelligenceEngine.js)

Not a new feature — a correctness fix to the oldest engine in this
stack, directed by the user after reviewing `ARCHITECTURE_REVIEW.md`.
That review's single most concrete finding: `computeRecommendation()`
inserted a new `recommendations` row on **every** call, including from
the public, unauthenticated `api/intelligence-demo.js` endpoint hit by
every homepage/room page load — measured directly (5 rows → 7 from 2
calls). Fixed exactly in the order the user specified: canonical
derivation first, purity second, intentional persistence third,
deduplication fourth, then the two smaller findings (certainty
vocabulary, staleness).

**1. Canonical baseline derivation.** `lib/intelligenceEngine.js` gained
`deriveGoalState({subjectId, goalId})` — a pure function that computes
requirement state, readiness, current focus, and related capability
using `ChewScenarioEngine.deriveState()` (`scenario-engine.js`)
directly, instead of `computeRecommendation()`'s own separate inline
loop. This is the same shared primitive `lib/scenarioModel.js`'s
`buildBaselineSnapshot()` already calls — both converge on one function
rather than one importing the other, which would create a circular
dependency (`scenarioModel.js` already imports FROM
`intelligenceEngine.js`; the reverse was never attempted). Two more
exact duplicates were found and removed in the same pass:
`getRequirementSequence(goalId)` (already existed, but
`computeRecommendation()` had its own separate, differently-joined query
for the identical data — now consolidated onto one call, extended to
also return each requirement's real `id`, needed for `actions`) and the
real-facts-by-key query (byte-identical between `computeRecommendation()`'s
inline version and `scenarioModel.js`'s private `getRealFactsMap()` — now
one exported `getFactsMap()`, with `scenarioModel.js`'s own name aliased
to it so none of that file's five call sites needed to change). The two
undocumented client-side reimplementations in `future-room.html` and
`chew-lab.html` were **not** touched this pass — both already trust the
server-computed `met` flags rather than re-deriving them, the lower-risk
half of the duplication (see `ARCHITECTURE_REVIEW.md` §3a); consolidating
those is a smaller, separate follow-up, not required to fix the
correctness bug this pass targeted.

**2 & 3. Recommendation purity + intentional persistence.** One function
became two:
- `computeRecommendation()` — **PURE.** Calls `deriveGoalState()`,
  shapes the result into the exact same public contract every caller
  already depended on (verified: no HTML page reads `.id`/`.computedAt`/
  `.action` from a `recommendation` object — only `basedOnFacts`,
  `chosenRequirementKey`, `basedOnConstraints`, so removing those fields
  from the pure return broke nothing). Writes nothing, ever.
- `recordRecommendation()` — the **only** function in this file that
  writes to `recommendations` or `actions`. Computes via the same
  derivation, then persists a new row only when warranted (see
  dedup below).

This is now locked as a permanent doctrine, not a one-off fix — see
`ARCHITECTURE.md`'s new §21, "Recommendation purity": *reading CHEW
intelligence must not change CHEW intelligence*. Every future engine in
this stack should follow the same pure-compute / dedup-and-record split.

A real functional gap surfaced by making every GET pure, caught before
it shipped: previously, ANY read (including a bare GET) created the
first pending `actions` row for a goal as a side effect — with GET now
pure everywhere, nothing did anymore, and `api/intelligence-actions.js`'s
POST requires an *existing* action to complete one. Fixed by giving
`api/intelligence-recommendation.js` a genuine second method:
GET stays pure; **POST** calls `recordRecommendation()` directly — the
one explicit, named way to establish (or refresh) a goal's first real
recorded recommendation and its first pending action, matching the same
"explicit command warrants history" carve-out `intelligence-actions.js`'s
own POST already uses after `completeAction()`.

**4. Deduplication.** `recommendations` gained two new columns
(`state_fingerprint`, `rule_version` — `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS`, the same idempotent pattern this file already used twice
for `transition_requirements.capability_id`/`recommendations
.related_capability`). `recordRecommendation()` computes a SHA-256
fingerprint over exactly the fields that define WHAT is recommended and
why (`chosenRequirementKey`, `recommendedAction`, `missingFactKeys`,
constraint ids, `relatedCapability.available` + provider count) —
deliberately excluding anything volatile — and compares it against the
most recent persisted row for that subject+goal, reusing
`lib/util.js`'s existing `stableStringify()` + the identical dedup shape
`lib/weatherModel.js`'s `state_snapshots` already use, rather than
inventing a third fingerprinting scheme. A fingerprint match returns the
existing row (`wasNew: false`, `actions` untouched); a genuine
difference inserts a real new row and only then creates/reuses the
`actions` row.

**5. Certainty vocabulary consolidation.** The same five-value
uncertainty vocabulary was hand-typed in four separate SQL `CHECK`
constraints and two separate JS array literals (`ARCHITECTURE_REVIEW.md`
§3b). `lib/util.js` now holds one authoritative `CERTAINTY_VALUES` map
(six named string constants — `known`/`deterministic`/
`assumption_dependent`/`estimated`/`editorial`/`unknown`) plus the two
real compositions of it this schema actually uses:
`SCENARIO_UNCERTAINTY_CLASSES` (scenarios/goal_conflict_rules/
capability_relevance_rules — 5 values, includes `estimated`) and
`LEVERAGE_UNCERTAINTY_CLASSES` (leverage_items — a genuinely different
5-value set, includes `editorial` instead). `scenarioModel.js`,
`leverageModel.js`, and `frictionModel.js` all now import from this one
source instead of hand-typing their own copies — `frictionModel.js`'s
previous raw string literal (`const CERTAINTY = 'deterministic'`) is now
`CERTAINTY_VALUES.DETERMINISTIC`. The SQL `CHECK` constraints themselves
were **not** regenerated from JS — this repo has no build step to do
that safely — so per the user's own explicit fallback ("at minimum an
explicit invariant test"), a standalone test inserts every JS-canonical
value into all three real tables (each in a rolled-back transaction,
nothing left behind) and confirms the DB accepts every one and rejects
both a nonsense value and the *other* vocabulary's own value on each
table (e.g. `goal_conflict_rules.certainty` correctly rejects
`'editorial'`; `leverage_items.uncertainty_classification` correctly
rejects `'estimated'`).

**6. Shared staleness semantics.** `lib/util.js` gained
`flipToStaleOnce({alreadyStale, markStale})` — a four-line guard
factoring only the "if already stale, stop; otherwise flip exactly once"
shape shared by `scenarioModel.js`'s `checkStaleness()` and
`leverageModel.js`'s two near-identical inline sweep blocks (one of
which literally commented "mirroring `discoverMultiGoalFactLeverage`'s
own"). Deliberately does **not** decide what "no longer fresh" means for
any table — scenarios compare a preserved baseline against real current
state; leverage_items compare either evidence equality or membership in
a freshly-discovered set — those genuinely different definitions stay
with their own callers, never merged into one framework, matching the
user's own "not an overgeneric framework" instruction. `leverageModel.js`'s
two sweep blocks were also consolidated into one shared
`sweepStaleLeverageItems({subjectId, sourceType, leverageCategory,
currentSourceRefs})`, called from both `discoverMultiGoalFactLeverage()`
and `discoverDormantCapabilityLeverage()`. Every literal `UPDATE`
statement stays at its own call site — this never builds SQL
dynamically.

**Tests.** Two new suites: `recommendation-purity-test.js` (38
assertions — pure-read correctness for both real goals, **100 identical
reads producing zero new `recommendations`/`actions` rows**, first
`recordRecommendation()` call creates real history with a real
fingerprint and `rule_version`, ten repeated calls with no real change
all dedupe to the identical row id, a genuine fact change produces a
genuine new row with a genuinely different fingerprint, full revert) and
`certainty-vocabulary-test.js` (20 assertions — the DB/JS alignment
proof above). `world-state-invariant-test.js` (from the architecture
review) was updated in place: its own "2 reads → 2 new rows" assertion,
which had proven the bug, was flipped to prove the fix (2 reads → 0 new
rows) and extended with the user's own named invariant — **100 identical
intelligence reads across both real goals produce zero new domain-history
records** — 10 assertions, all passing. All ten scratch test files
(scenario, conflict, parallel-futures, leverage, dormant-capability,
weather, friction, recommendation-purity, certainty-vocabulary,
world-state-invariant) re-run together fresh: 284 total assertions, zero
failures. Verified over real HTTP against a freshly restarted server:
10 real hits to the public `/api/intelligence-demo` produced zero new
`recommendations`/`actions` rows (the exact bug, reproduced and
confirmed fixed over the wire); `POST /api/intelligence-recommendation`
correctly created the first real recommendation + action; completing
that real action via `POST /api/intelligence-actions` correctly advanced
to the next requirement, correctly reported `wasNewRecommendation: true`
for the genuine transition; all scratch rows and facts fully reverted to
the real seed baseline afterward; both feature flags (`intelligence_engine`,
`intelligence_demo`) confirmed at their real production defaults when
done. The production database was never touched.

**What this pass deliberately did not touch**: the two client-side HTML
reimplementations of readiness/chosen-focus selection
(`future-room.html`, `chew-lab.html`) — lower-risk than the fixed
server-side duplication since both already trust server-computed `met`
flags; `goal_conflict_rules`' missing `authored_by`/`effective_date`
provenance columns (named in the review, not requested this pass);
`recommendations.rule_version` was added as part of the fingerprint work
above, closing that review finding as a direct byproduct rather than a
separate task.

## Economic Weather — real opportunity identity (lib/capabilityGraph.js, lib/weatherModel.js)

The next bounded slice after the recommendation-purity fix, directed at
exactly what that fix unblocked: opportunity/history reads are now
side-effect-free, so it became safe to make the Opportunity Access
signal historically precise instead of count-only.

**The premise was checked before anything was built, and didn't hold.**
The directive named this "Credit Opportunity Access" and asserted
"opportunity identity is stable for Credit." Verified directly: no
capability related to credit exists in the real registry (all 9 real
capabilities checked by slug and name), the home goal's `credit_score`
requirement carries no `capability_id` at all, and `network_providers`
remains permanently empty in production, same as every other capability
this session has found. Reported this back before writing any code; the
corrected directive confirmed building the mechanism generically and
proving it honestly, never hardcoding "Credit" into the signal, and
never fabricating a capability or provider to make the feature
demonstrable.

**Canonical opportunity identity.** `lib/capabilityGraph.js` gained
`getActiveProviderIds(capabilitySlugs)` — the real, deduped set of
currently active+ready `network_providers.id` values across a set of
capability slugs, the same `status = 'active' AND is_ready = TRUE`
condition every other real availability check in this file already
uses. A real provider id is the canonical identity; never a title, an
array index, or a fuzzy match.

**Schema.** `state_snapshots` gained `active_opportunity_ids JSONB`
(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, the same idempotent pattern
this file already established twice). Same null-vs-empty-array
discipline as the existing `active_opportunity_count` column: `NULL`
means this goal's real requirement chain links no capability at all (no
pipeline to track); `[]` means a real link exists but zero providers are
currently active (a real, legitimate zero, not the same as "no
coverage"). `newly_unlocked_opportunity_ids` was deliberately **not**
added as a column — this file's own existing comment already establishes
why comparative fields aren't persisted redundantly
(`newly_unlocked_opportunity_count` was never a column either); the
added/removed sets are computed at `buildEconomicWeather()` comparison
time from two real `active_opportunity_ids` arrays. Critically, the
sorted id array was added to `fingerprintFields()` — without this, a
real composition change (the same count, different real opportunities)
would have been silently deduped as "identical state" and never captured
as a new snapshot, quietly defeating the entire feature. Verified
directly: 5 repeated reads against a genuinely unchanged real opportunity
set created zero new snapshots.

**Five real composition states, via real set comparison, never a count
alone.** `classifyOpportunityComposition(currentIds, priorIds)`:
`unchanged` (same real ids), `expanded` (a real superset — only
additions), `contracted` (a real subset — only removals),
`composition_changed` (same count, a same-size swap of real ids — **the
sophisticated case**, proven directly: `[A] → [B]`, count held at 1 both
times, CHEW correctly said "the count held at 1, but the real
opportunities are different," never "unchanged"), and `mixed`
(asymmetric add+remove — e.g. 1 removed + 2 added — that doesn't cleanly
fit either expansion or contraction). Always a pairwise comparison
against the immediately prior comparable observation, not a
multi-observation trend the way the numeric signals (readiness,
constraint pressure) are — composition is a real add/remove diff between
two states, and the user's own five-state vocabulary has no
"improving-over-three-observations" concept for it.

**Scope, not a domain label.** The `opportunity_access` signal now
carries real `scope` (`{goalId, goalTitle, goalCategory}` — the actual
goal this observation belongs to, e.g. `business`) and `coverage`
(`linked`/`unlinked` — whether this goal's own chain links a capability
at all, independent of whether any provider is currently active).
Nothing in the signal contract ever says "Credit," because no real
Credit pipeline exists — confirmed by a direct test scanning the
registry for any capability whose slug or name matches "credit" (none
found). The one real link this repo has — `bookkeeping_current` →
`accounting_tax`, on the business/funding goal — is what the proof below
is actually built against.

**The proof, exactly matching the corrected directive's Observation
A–D script**, run against live Postgres:
- **Observation A** (seed a real opportunity, capture): `activeOpportunityIds: [A]`, `trendClassification: 'current_state_only'`.
- **Observation B** (same real provider; an unrelated real fact toggled elsewhere to force a new material snapshot without touching the opportunity set): `[A] → [A]`, `'unchanged'`.
- **Observation C, superset** (a second real provider added): `[A] → [A,B]`, `'expanded'`.
- **Observation C, replacement — the sophisticated case** (isolated block: the one real provider deactivated, a different real provider added): `[A] → [B]`, same count both times, `'composition_changed'`.
- **Observation D** (the real provider deactivated, none added): `[A] → []`, `'contracted'`.
- **Extra, beyond the script**: an asymmetric case (1 real provider removed, 2 different real providers added simultaneously): `'mixed'`, net count still genuinely moved (2→3) while composition churned in a way that isn't a clean expansion.

Also verified: creating a real hypothetical Scenario mid-test produced
zero new opportunity-history snapshots (history/scenario boundary holds
for this signal too); the real production baseline (business goal, zero
active providers, capability genuinely linked) is honestly `available`
with `currentState: 0` — distinct from the home goal's honest
`unavailable` (no link at all); every scratch provider and link was
deleted at the end of every block, with a final check confirming
`network_providers` is empty, exactly the 9 real capabilities still
exist, and none of them match "credit" by slug or name.

**Tests**: 31 assertions (`opportunity-identity-test.js`) — the unit-level
5-state classifier proven directly on synthetic id sets first, then the
full real-database proof above, the fingerprint-dedup proof, the
scenario-leakage proof, and full teardown verification. Re-verified over
real HTTP against a freshly restarted server: seeded a real provider,
confirmed `expanded`; deactivated it and added a different real provider,
confirmed `composition_changed` with the identical explanation text the
Node-level test produced; fully reverted every scratch row and the
feature flag; confirmed the endpoint returned to 404. All 11 intelligence
test suites re-run together afterward: 315 total assertions
(284 from the prior pass + 31 new), zero failures. The production
database was never touched.

**CHEW Lab connection**: Bay 03's "Uses" list gained one line disclosing
this real proof — the bay's own two live public gauges and Experimental
status are unchanged; this remains internal-only, same as the rest of
the historical engine.

**What remained honestly unavailable at the time**: as of this pass, the
home/housing goal had no *requirement-level* capability link, so it
showed `unavailable` for Opportunity Access. That was the honest state of
the real registry at the time, not a bug — see the next section for how
it changed once a second real relationship was checked.

## Economic Weather — the second real pipeline: goal-level relevance (lib/capabilityGraph.js, lib/weatherModel.js)

Directed as the follow-up to the pass above: extend the mechanism to a
second real relationship, `capability_relevance_rules` (`source_type =
'goal'`) — the same real rule `lib/leverageModel.js`'s Dormant Capability
detector already reads (rule id 1: the home goal → `real_asset_execution`,
`active = true`). This is a genuinely different real relationship than a
`transition_requirements.capability_id` link — a human-authored statement
that a capability is relevant to a goal's execution overall, not that a
specific requirement in the chain depends on it. Blurring the two into one
generic "linked" claim would have violated the master directive's
"editorial ≠ deterministic relationships" doctrine, so they're kept
explicit instead.

**`getGoalRelevantCapabilitySlugs(goalId)`** (`lib/capabilityGraph.js`):
a real query against `capability_relevance_rules JOIN capabilities`,
`source_type = 'goal' AND source_ref = $1 AND active = TRUE` — deliberately
only ever returns what a real `'goal'` rule declares, matching Dormant
Capability's own documented boundary that only `'goal'` source_type has
real, exercised logic in this schema (`'requirement'`/`'fact'` relevance
rules are legal schema values with no seeded row yet).

**`linkType` disclosure.** `computeCurrentStateFields()` in
`lib/weatherModel.js` first checks the existing requirement-level
`capabilityCoverage`; only when that's absent does it fall back to
`getGoalRelevantCapabilitySlugs(goalId)`. Whichever real relationship
supplied the linked capability slugs, the signal now discloses which one
via a new `linkType` field (`'requirement' | 'goal_relevance' | null`),
carried through `rowToSnapshot()`, `fingerprintFields()`, the
`state_snapshots` INSERT, and `buildEconomicWeather()`'s explanation text
— e.g. "via a real capability_relevance_rules relationship, not a direct
requirement link" for `goal_relevance`, versus the plain "linked
capabilities" phrasing for `requirement`. Requirement-level always takes
precedence when both could theoretically apply (not a real scenario in
current data, but structurally sound). Schema: `state_snapshots` gained
`active_opportunity_link_type TEXT CHECK (... IN ('requirement',
'goal_relevance'))` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, the same
idempotent pattern used throughout this file).

**Proof.** The home goal now honestly shows `available` /
`coverage: 'linked'` / `linkType: 'goal_relevance'` with `currentState: 0`
(real_asset_execution has no active provider yet — a real zero, not a
fabricated one) — never a fabricated "Credit" claim, and never the old
"unavailable" now that the real second relationship is actually checked.
The same full Observation A–D proof already run against the business
goal's requirement-level pipeline was re-run against this pipeline
independently: `current_state_only` (1 provider seeded), `expanded` ([H1]
→ [H1,H2]), `composition_changed` (the sophisticated case: [H1,H2] →
[H2,H3], count held at 2, correctly reported as composition change, not
"unchanged"), and `contracted` ([H2,H3] → []) — all via real
`network_providers` rows linked to `real_asset_execution`, fully deleted
afterward. A regression check confirmed the business goal's own signal
still resolves `linkType: 'requirement'` and is untouched by the new
fallback existing. Re-verified live over real HTTP against a freshly
restarted server: baseline `goal_relevance` disclosure, a seeded provider
producing `expanded`, and its removal producing `contracted`, with the
exact same explanation text the Node-level test produced; every scratch
row and the feature flag were fully reverted afterward.

**Tests**: `opportunity-identity-test.js` extended from 31 to 39
assertions (Block 0's baseline check updated to match the new honest
home-goal state, plus a new Block 6 covering this pipeline end-to-end and
the business-goal regression check). All 14 non-UI intelligence test
suites re-run together afterward, zero failures (the remaining suites in
the scratch test directory cover Playwright-driven UI pages and require a
browser-automation package not installed in this container — unrelated to
and unaffected by this backend-only change). The production database was
never touched.

**Cross-room aggregation was deliberately not built in this pass.** Two
rooms (business/`accounting_tax` via a requirement, home/`real_asset_execution`
via a goal-level rule) now have a real, persisted opportunity-identity
pipeline each, with explicit `linkType` provenance — the stated
prerequisite for it. But the user's own directive was to extend the
mechanism to this one additional real relationship, not to build
aggregation across rooms; per the master directive's Cross-Room
Aggregation Rule, that's a separate, explicitly-scoped step for when it's
actually asked for, not an inferred next task. See the next section for
where it was actually built, once the prerequisite existed and was
explicitly requested.

## Economic Weather — cross-room provenance: the global Opportunity Access signal (lib/weatherModel.js, api/weather-model.js)

Directed by the "FINAL INTELLIGENCE-FIRST, VISUAL-SUPREMACY-AFTER MASTER
DIRECTIVE," specifically its Cross-Room Aggregation Rule: *"A global CHEW
signal may never imply broader coverage than the rooms actually
contributing to it,"* with a worked example — `Opportunity Access —
Mixed`, then expandable per-room provenance (`Business: Expanded`,
`Accounting: Unchanged`, `Home: Unavailable`) rather than a global score
that hides an unavailable room.

**Premise checked before writing anything, per this build's own standing
discipline.** Before this pass there were only two real goals in the
entire schema (home id=1, business id=2), confirmed again by a fresh
query rather than recalled from memory, and both already had a real
opportunity-identity pipeline from the prior two passes. There was no
third real room to add — extending "room by room" further would have
meant fabricating a goal, which the doctrine forbids. So this pass builds
exactly what was asked: the aggregation mechanism across the two real
rooms that had already earned participation, not a new room.

**`getGlobalOpportunityAccess({subjectId})`** (`lib/weatherModel.js`):
queries every real `active` goal for the subject, then calls the exact
same, already-proven `getEconomicWeather()` pipeline independently per
goal — no new derivation logic, no second way of computing what a room's
opportunity state is. A `provenance` array names every real room by
title, category, its own real `trendClassification`, `availability`, and
`linkType`, exactly matching the directive's own worked example format.
No new table was added — this is a pure, real-time aggregation over the
already-real per-goal `state_snapshots` history each room already writes
via its own `getEconomicWeather()` call; a persisted global history table
would be speculative scope beyond what was asked, and can be added later
if a *global* trend-over-time concept is ever requested.

**The aggregation rule, applied only to rooms that actually contribute
(`availability === 'available'`):**
- 0 contributing rooms → global classification `unavailable` (never a
  fabricated `unchanged` or `0`).
- 1 contributing room → the global classification is that room's own
  real classification directly — no aggregation ambiguity to invent.
- 2+ contributing rooms, all sharing one real classification → that
  shared classification.
- 2+ contributing rooms with genuinely differing classifications →
  `mixed` — the real world changed differently across rooms, and saying
  anything else would hide that.

`currentState` is the real sum of active-opportunity-id counts across
*contributing* rooms only — an unavailable room is never counted as a
real 0, matching the doctrine's "unavailable ≠ zero" rule at the global
level too. `roomCoverage` (`'full' | 'partial' | 'none'`) discloses how
many of the subject's real rooms actually contributed, so a caller can
never mistake a 1-of-2-room signal for full coverage. Every unavailable
room is named individually in the `explanation` string, never folded
silently into the rollup — e.g. `"Opportunity Access — Contracted (1 of 2
rooms currently have a real opportunity pipeline) (Buy a first home
(example): Unavailable; Get business funding-ready (example):
Contracted)."`

**API**: `GET /api/weather-model?action=global` — no `goalId` required,
same `economic_weather_foundation` gate as every other action on this
endpoint.

**Proof, run against live Postgres**: reset both real rooms to a shared
fresh baseline (`current_state_only`, `roomCoverage: 'full'`); seeded a
real provider on business only, reproducing the doctrine's own worked
example exactly — global `Mixed` with `Business: Expanded` / `Home:
Unchanged`; expanded both real rooms together in the same observation
window to prove the shared-classification branch (`Expanded`, not a
fabricated `Mixed`, when both rooms genuinely agree); temporarily
deactivated the home goal's one real `capability_relevance_rules` row
(the same real-row-toggle technique `dormant-capability-test.js` already
established, not a fabrication) to prove `roomCoverage: 'partial'` with
the unavailable room named by title, not hidden; then temporarily removed
*both* real relationships (the business requirement's `capability_id` set
to `NULL`, the home rule deactivated) to prove the zero-coverage case:
global `unavailable`, `currentState: null`, every room individually named
unavailable in `provenance`. Every real row touched was reverted and
verified back to its original value.

**Tests**: `cross-room-provenance-test.js` — 20 new assertions. All 13
non-UI intelligence test suites (now including this one) re-run together
afterward, zero failures. Re-verified live over real HTTP against a
freshly restarted server: the baseline full-coverage signal, the exact
doctrine worked-example `Mixed` case reproduced live from a real seeded
provider, and the partial-coverage case with the unavailable room
disclosed by name — all with the identical explanation text the
Node-level test produced. Every scratch row, the deactivated relevance
rule, and the feature flag were fully reverted afterward; the production
database was never touched.

**What this does not do**: there is still no visual surface for any of
Economic Weather's signals (global or per-room) — this remains an
internal-only, `internal`-gated API, same as the rest of the historical
engine. This pass built the data contract the directive's own Phase 2
"Opportunity Radar," "Economic Weather," and cross-system focus moments
would read from; it does not attempt any of those visual moments itself.

## Phase 2, Slice 1 — CHEW Activation + Hero Intelligence Environment (index.html, styles.css, script.js)

The first slice of "FINAL INTELLIGENCE-FIRST, VISUAL-SUPREMACY-AFTER" —
begun once Phase 1 (canonical identity, cross-room provenance, side-
effect-free reads, real history) was judged complete enough. This slice
touches only the public homepage's opening experience; no backend or
intelligence-engine code changed, and none of the doctrines above were
loosened — every visual state below maps to a real field from
`/api/intelligence-demo`, an already-existing, already-tested endpoint.

**CHEW Activation, rebuilt.** The two simple radial lines from the
original build were replaced with an architectural sequence: four corner
brackets resolve (a hairline frame, not a loading spinner), then a small
hub-and-node topology draws in via real `stroke-dashoffset` animation —
deliberately using the same visual grammar (a hub with radiating nodes)
the hero field below actually uses, so the activation reads as "the same
system waking up," not a disconnected splash screen. The mark and
wordmark resolve last. Still one-shot per browser session
(`sessionStorage`), still an instant no-op under `prefers-reduced-motion`,
still dismissible early — a `Skip` button was added (the original build
only supported click-anywhere-to-dismiss, undiscoverable without a visual
affordance), and the auto-dismiss timeout is now mobile-aware (shorter on
narrow viewports, matching the "mobile must be its own experience" rule).

**The hero, rebuilt into a live intelligence environment, not headline +
paragraph + decoration.** The old hero's purely decorative elements
(a photo layer gated on a file that was never supplied, ambient
gradient rings, a static bar-chart SVG, a wave divider) were removed —
none of them represented anything real. The goal picker, previously a
separate section below the hero, now lives inside the hero itself, and
selecting a goal drives a real node field (`#hx-field`) built from that
goal's actual `requirementSequence` (real `transition_requirements`,
ordered by real `sequence_order`) — this is the "selecting a goal
reconfigures the visual system" requirement, verified directly: the home
goal (3 real requirements) and the business/funding goal (2 real
requirements) produce genuinely different node counts, layouts, and
labels, not a text swap over a fixed template. A dormant idle state (a
single slowly-rotating hub with a plain-text hint) fills the field before
any goal is picked, so the hero doesn't read as broken/empty pre-interaction.

**THE CHEW MOVE REVEAL — five real stages, adapted honestly to what this
schema actually records.** The directive's own script (multiple moves
appear → low-value dim → blocked collapse → dependent group → one
remains) was mapped to the real fields that exist, not fabricated ones:
this schema has no "blocking" relationship between two requirements, only
a real `sequence_order`, so "blocked" became **"Next in sequence"** — an
honest, real label, never an invented causal claim (the same "correlation
≠ causation" / "editorial ≠ deterministic relationships" doctrine
enforced throughout Phase 1). Concretely, staged over real time:
1. all real requirement-nodes appear together around the hub, pulsing, undifferentiated ("considering")
2. real `met: true` requirements settle and dim — labeled "Resolved"
3. requirements sharing a real, non-null `capabilitySlug` get a connecting dashed arc — labeled "Connected" (mechanism is real; with today's seed data neither demo goal has 2+ requirements sharing one capability, so this branch is currently dormant — same honest gap this build has already disclosed elsewhere, e.g. `linkType: 'goal_relevance'` before it had real data to exercise it)
4. remaining real unmet, non-chosen requirements recede — labeled "Next in sequence"
5. the engine's own real `chosenRequirementKey` scales up, its edge glows gold, and a banner reveals the engine's own real `recommendedAction` + `rationale` text verbatim — never re-derived or reworded client-side

All staging is skipped (every end-state applied at once) under
`prefers-reduced-motion`, verified directly via a Playwright context with
`reducedMotion: 'reduce'`.

**Demo Truth Boundary.** The "sample/demonstration" disclaimer (already
required by an earlier directive) now uses a distinct blue `tag--sample`
token rather than the site's gold accent, so it reads visually as a
disclosure, not a call-to-action — and only becomes visible once a real
API response actually arrives (a real bug was caught and fixed here: the
element's own CSS `display` declaration was overriding the browser's
`[hidden]` attribute, so the empty disclaimer badge rendered before any
goal was ever selected — fixed with an explicit `.reveal-disclaimer[hidden]
{ display: none; }` rule).

**Design language.** Deep black, the existing Ember Gold family, hairline
architectural geometry (corner brackets, thin edge-lit borders), and a
new `.hx-metal` premium-glass primitive (layered gradient + inset
highlight + real box-shadow depth, not `backdrop-filter` blur) — added
additively in `styles.css`; none of the site's existing `.glass`/`.card`
usage elsewhere was touched, so this slice is fully scoped to the
homepage hero and doesn't risk the other ~20 pages. No generic
blue/purple gradients, no particles, no crypto/Web3 clichés, no "AI
brain" imagery.

**Accessibility.** The node field is `aria-hidden` — legitimate only
because every real fact it displays is duplicated in accessible text
elsewhere on the page (the existing `#reveal-chain` breakdown, and the
new move-banner's plain-text action/rationale), satisfying "no meaning
conveyed only by animation/glow/color." Goal buttons are real `<button
aria-pressed>` elements, fully keyboard-operable (verified: focusing a
goal button and pressing Enter triggers the real fetch and the full
reveal sequence, identical to a click). Decorative field nodes are
confirmed not to introduce spurious tab stops.

**Mobile.** The two-column hero collapses to a single stacked column
below 980px (not a shrunk desktop layout) — copy and goal picker first,
field and move banner following on scroll; verified at a 390×844 mobile
viewport with the field scrolled into view, at 834×1112 tablet, and at
1440×900 desktop.

**Validation.** Real Chromium (Playwright) screenshots captured at all
three breakpoints across seven states each (pre-activation, idle hero,
field mid-reveal at two staged timestamps, move revealed, and after
switching to the second real goal to prove reconfiguration), plus a
dedicated `prefers-reduced-motion` pass and a keyboard-only interaction
pass. Two real defects were caught and fixed this way — the disclaimer-
visibility bug above, and a 2-node field defaulting to a perfectly
vertical line through the hub (now offset for a legible spatial spread)
— exactly the discipline this file's own testing sections have already
established. Zero JavaScript runtime errors across every viewport and
interaction; the only console errors observed (a Google Fonts
`ERR_CONNECTION_RESET` and an automatic `/favicon.ico` 404) are pre-
existing environmental artifacts of this sandbox having no outbound
internet access and no declared favicon `<link>`, unrelated to and
unaffected by this change.

**What this slice does not attempt.** Per the visual-supremacy ordering
in the master directive, Life Map, Opportunity Radar, Domino, Future-
Back, and the rest remain as they were — this pass touched only the
hero's opening experience. Sound and haptics were not attempted (out of
order per the directive's own sequencing). No backend change was made;
every visual state here was already fully supported by the existing,
tested `/api/intelligence-demo` contract.

## Phase 2, Slice 2 — Life Map Showcase (index.html, styles.css, script.js)

The second visual-supremacy slice: "one level deeper" from the hero,
making the Life Map feel like a real zoom level of CHEW's world rather
than another section on the page.

**Reused the real existing data model verbatim — no second map
invented.** `LIFEMAP_LABELS` (8 territories) and `LIFEMAP_EDGES` (13
curated editorial relationships, each with a real reason string) are the
exact same constants already built and shipped in the prior Life Map
pass — unchanged. This slice adds presentation and choreography around
that data, never a parallel model. One new editorial constant was added,
`LIFEMAP_WHY` — a single "why CHEW connects these" sentence per
territory, same editorial status as `LIFEMAP_EDGES`, satisfying the
directive's "Connection Story" requirement without turning the panel
into a textbook entry.

**Moved to sit directly after the hero**, ahead of the below-field
progressive-disclosure content (Blind Spot/Domino/Radar/Future-Back),
so scrolling out of the hero lands on Life Map first — the "one zoom
level deeper" continuity the directive asked for, not a generic section
further down the page.

**Goal continuity.** A new small shared variable (`chewLastSelectedGoal`,
set by the existing hero goal-button handler) is read once, the first
time Life Map scrolls into view. If the visitor already picked a real
demo goal in the hero, CHEW auto-selects the one territory it's
editorially mapped to (`LIFEMAP_GOAL_FOCUS`: `home → property`,
`funding → business`) — both chosen because they're the territory each
real demo goal's own connections are richest for, using the exact same
selection function a manual click uses. This mapping is explicitly
editorial (documented as such in the code), not a database-derived
association — there is no real backend link between a demo goal and a
Life Map territory to draw from. If no goal was picked, the map settles
into its neutral state and invites exploration instead of forcing a
selection.

**Signature reveal choreography**, fired once via `IntersectionObserver`
(threshold 0.3): a hairline corner frame resolves, a faint "world
boundary" ring fades in, then all 8 territory nodes and their edges
stagger-draw using the real per-element `--node-delay`/`--edge-delay`
custom properties already present in the SVG markup. Only after that
settles does the goal-continuity auto-selection (if any) fire, followed
by the "CHEW sees the connections." signature line. Every stage collapses
to its instantly-final state under `prefers-reduced-motion`, verified
directly in a `reducedMotion: 'reduce'` Playwright context.

**Precision, not a floodlit map.** Selecting a territory (`lifemapSelect()`
— unchanged core logic, extended to also drive the new mobile list)
brightens exactly the selected node and its real connected neighbors;
every other territory recedes to a genuinely low-contrast "background"
tier. Real depth through interaction state, not a fabricated 3D effect —
matching the directive's own instruction not to overcomplicate a
CENTER/INNER/OUTER hierarchy that doesn't map to anything real.

**A genuine mobile-specific composition, not a shrunk diagram.** Below
640px the SVG orbital diagram and its hit-layer are hidden entirely and
replaced with `#lifemap-mobile` — a real vertical list of territory
buttons, built once from the same `LIFEMAP_LABELS` data, wired into the
exact same `lifemapSelect()`/`lifemapClearState()` functions via the
shared `[data-territory]` contract (one source of truth, two
presentations, not duplicated selection logic). Touch targets are a real
52px minimum height.

**Real bug found and fixed during screenshot validation — pre-existing,
not introduced by this slice.** The `.lifemap-wrap.has-selection
.lifemap-node circle { opacity: 0.3 }` rule (three classes, specificity
0,3,1) had always had higher CSS specificity than `.lifemap-node
.is-selected circle`'s properties (two classes, 0,2,1) for the `opacity`
and `stroke` properties specifically — meaning a selected or connected
node was silently rendering at the dimmed, unselected opacity the whole
time this feature has existed, just subtly enough (small gold-tinted
circles on a dark background) that it went unnoticed by eye until this
slice's added `filter: saturate(0.5)` on the same rule made the effect
more visually obvious in a screenshot. Fixed by adding explicit
`:not(.is-selected):not(.is-connected)` (and `:not(.is-lit)` for
spokes/edges) to every one of the four affected dimming rules, so the
cascade can never again silently override the exact states the feature
exists to highlight. Verified directly: DOM state showed the correct
class before the fix (`propNodeClasses: "lifemap-node is-selected"`), so
this was purely a CSS specificity defect, not a JS logic defect —
confirmed by re-screenshotting after the fix and seeing the selected
node render fully gold, scaled, and glowing as intended.

**Tests**: real Chromium screenshots across desktop/tablet/mobile ×
{neutral reveal, goal-continuity reveal, manual territory selection},
plus a dedicated `prefers-reduced-motion` pass and a keyboard-only
selection pass (focus a territory button, press Enter, confirm
`aria-pressed` and the detail panel's real connection text both update
identically to a mouse click). A full-page scroll-through of the entire
homepage confirmed zero JS errors and no layout regression in any
section below Life Map from the section reorder. The Slice 1 hero test
suite was re-run in full and produced pixel-identical results — zero
regression.

**What this slice does not attempt.** No cross-system "Focus Mode" reuse
from the portal (documented in the master directive as optional,
concept-only, and this repo has no portal code to draw from). No sound.
Business/Real Estate/Insurance's own "engine" pages (business-pathfinder,
network-room, etc.) are unchanged — only the Life Map's own presentation
was touched. Per the visual-supremacy ordering, the next slice is CHEW
Move Showcase.

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
    wired to a subject's real data); the Liquidity/Income Stability
    gauges inside CHEW Lab's Economic Weather bay specifically (Readiness
    and Constraint Pressure are real and live on this public bay — see
    above — and a real history-over-time engine now exists internally
    too, with genuine trend classification — see "Economic Weather"
    below — but liquidity and income data don't exist anywhere in this
    schema, so those two stay marked "n/a" rather than estimated); "What
    Changed," Hidden Leverage, and Friction Detection as real (rather than
    fixed-illustrative) *public* experiences specifically. The real
    internal capability each of these needs now exists — Hidden Leverage's
    and Friction Detection's own sections above, gated `internal` — but
    wiring either onto this public page still needs a real member
    identity system to hold a real subject's own history, not a fixed
    shared illustrative one; building a public "demo" against the shared
    illustrative subject alone would mean fabricating a personal history
    that was never seeded, which is different from labeling a single
    static scenario as an example. "What Changed" itself has no internal
    engine yet at all — see "What remains unavailable" in the Friction
    Detection section above for why that connection specifically isn't
    wired yet even architecturally. Conflict Detection as a *public* experience
    specifically belongs in this same bucket now, not the "just not
    built yet" one below — a real, rule-backed internal engine exists
    (see "Multi-goal Conflict Detection" above), gated `internal`
    pending a real member identity system; CHEW Lab's own Conflict
    Detection bay discloses that engine's existence but stays a fixed
    public sketch, on purpose, until identity exists to wire it to.
  - **Just not built yet, execution-bandwidth only**: a *public* Parallel
    Futures experience specifically. The legitimate scenario-modeling
    layer this used to be blocked on now exists — see "The Scenario
    Modeling Foundation" above, including a real, deterministic,
    internal-only `compareParallelFutures()` — but it's gated `internal`
    pending a real member identity system, so no public page is wired to
    it yet. Impact Comparison, built in the Simulation Room, remains the
    honest, non-fabricated public version of this same instinct; CHEW
    Lab's own Parallel Futures bay is still a fixed illustrative sketch,
    explicitly labeled Simulation, with its transparency block now
    disclosing that the real internal engine exists behind it,
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
