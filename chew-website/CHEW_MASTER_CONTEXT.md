# CHEW_MASTER_CONTEXT.md
**CHEW LLC — Living Source of Truth**
Last updated: July 2026 | Maintained per the Master Project Directive's Development Rules

This is the one document every future session should read first. It exists so no future
work contradicts, duplicates, or forgets a decision already made. When something changes,
this file changes with it — it is not a one-time deliverable.

---

## 1. Executive Constitution (Summary)

**Legal name:** CHEW LLC
**Meaning:** Creating Honest Economic Wealth
**Tagline:** Technology that Creates Opportunity.
**Founder/Contact:** Leroy Thompson — leroyt@joinchew.com
**Domain:** joinchew.com (owned, confirmed live)

**Mission:** Build technology, AI, software, automation, and educational platforms that
help individuals, entrepreneurs, businesses, nonprofits, and communities create sustainable
economic opportunity through knowledge, integrity, innovation, and long-term value.

**Vision:** Become one of the world's most trusted technology companies. Think in decades.

**Identity — non-negotiable:**
- CHEW is a technology company first. Consulting is the initial revenue stream funding
  software development, not the end goal.
- Never resembles a credit repair company.
- Never uses hype or unsubstantiated claims. No "guaranteed approval," no invented
  testimonials or statistics, no imagery implying guaranteed wealth outcomes (this was
  explicitly tested and rejected — see Section 9, Decision Log).

**Core Values:** Integrity, Innovation, Education, Transparency, Excellence, Community,
Long-Term Relationships.

---

## 2. Brand Guide

**Color tokens (exact hex, in production CSS):**
- Black: `#0A0A0A` / Black-soft: `#131311`
- Gold: `#C8A63C` / Gold-light: `#E4C567` / Gold-deep: `#8F7024`
- Steel blue: `#2D6F8E` / Steel-light: `#4A93B5` / Steel-deep: `#1D4A5F`
- Text: `#F5F3EE` (on dark)

**Typography:** Playfair Display (headings) + Inter (body). Loaded via Google Fonts CDN.

**Logo — CRITICAL, read before touching anything visual:**
- The official logo is `assets/chew-icon-official.png`, sourced from the founder's original
  Adobe Illustrator file (`CHEW_LLC_LOGO.pdf`), NOT an AI-generated reinterpretation.
- The only edit ever made to it: the curved tagline text was updated from an outdated
  version (containing "...HELPING...") to "CREATING HONEST ECONOMIC WEALTH," matching the
  current brand meaning. This was done via careful pixel-level erase-and-replace that
  preserved the ring, bars, and "CHEW" wordmark completely unchanged (verified pixel-by-pixel).
- **Do not regenerate, reinterpret, or "improve" this logo's concept.** Per standing brand
  preservation directive: only minor refinements allowed (vector quality, sizing, color
  variants), never a redesign.
- It is currently a high-resolution raster (2833×2638px), not true vector — no vector
  extraction tool was available in this environment. If the original Illustrator file is
  ever provided again, re-extracting a true vector version is a worthwhile minor refinement.

**Rejected direction (for future reference, don't re-propose):** a "money/luxury goods
falling from the sky" background animation was requested once and talked through — rejected
for conflicting with "premium, calm, institutional" brand voice and for legal risk (real
car/jewelry brand imagery). Not revisited unless the founder explicitly asks again.

---

## 3. Website — Status: LIVE-READY (static, deployable today)

13 pages built: Home, About, Services, How It Works, Pricing, Resources, FAQ, Contact,
Book Consultation, Booking Confirmed, Privacy, Terms, Disclaimer.

All copy is real — no placeholder text, no fabricated stats or testimonials. Where CHEW
doesn't yet have proof (client outcomes, case studies), the site says so plainly rather
than implying a track record that doesn't exist yet.

**Hosting:** Deploy via Vercel (not Netlify Drop/GitHub Pages — those can't run the
serverless `/api` function payments depend on).

---

## 4. Pricing (Real, Confirmed by Founder)

| Tier | Price | Length |
|---|---|---|
| CHEW Strategy Session | $97 | 25 min |
| CHEW Growth Strategy Session | $197 | Extended |
| CHEW Executive Strategy Session | $297 | Priority |

Per the directive, pricing should eventually be admin-manageable rather than hardcoded —
that's an Admin Dashboard dependency (Section 7), not yet built.

---

## 5. Stripe & Payments — Status: FULLY BUILT, needs deployment + 3 account setups

- `/api/create-checkout-session.js` — creates Stripe Checkout session, places a soft
  hold on the selected time slot (DB unique constraint prevents double-booking races).
- `/api/available-slots.js` — returns real open slots (weekly template minus booked/held).
- `/api/stripe-webhook.js` — verifies Stripe signature, confirms the booking server-side,
  triggers confirmation email. **This is what makes the flow actually automated** —
  without it, payment succeeds but nothing else happens.
- `/api/send-reminders.js` — sends reminder emails. **Automatic cron trigger is
  temporarily disabled** (`vercel.json` is currently empty) after an "Invalid
  vercel.json" deploy error during initial setup — removed to get the core site
  deployed cleanly first. Reminders still work via manual trigger
  (`/api/send-reminders?manual=<CRON_MANUAL_SECRET>`); re-enabling automatic
  scheduling is a safe, small follow-up once the main site is confirmed live.
- `lib/db.js`, `lib/availability.js`, `lib/email.js` — shared helpers.
- `db/schema.sql` — one table (`bookings`), covers pending/confirmed/cancelled/expired
  states plus reminder tracking.

**Three accounts needed to go live** (none provisioned yet, all free to start):
Postgres (Vercel Postgres or Supabase), Stripe (founder already has this one live),
Resend (for email). Full step-by-step is in README.md.

**Booking availability:** fixed weekly template in `lib/availability.js` (Mon-Thu
9-4, Fri 9-1, America/New_York). No admin UI to change hours yet — that's an Admin
Dashboard dependency. Edit the file and redeploy to change hours for now.

---

## 6. Client Portal — Status: NOT BUILT (Phase 3)

Planned: dashboard, appointments, messages, documents/secure vault, progress, action
plans, resources, notifications, billing, profile. Requires auth provider (Clerk
recommended) and a database (Postgres) — neither is provisioned yet.

**Credit Access Center note:** when built, must never request/store passwords for
external credit monitoring accounts. Secure document upload + manual profile entry only,
consistent with the standing security directive.

---

## 7. Admin Dashboard — Status: NOT BUILT (Phase 4)

Planned: client management, appointments, revenue/payment reporting, CRM, analytics,
CMS, user roles, audit logs. Depends on Client Portal's data layer existing first.

---

## 8. Database Schema (Designed, Not Yet Provisioned)

```
User            id, email, role (client/admin), created_at, auth_provider_id
Client          id, user_id (FK), name, phone, onboarding_status
Consultation    id, client_id (FK), type, status, price_id, scheduled_at
Payment         id, consultation_id (FK), stripe_payment_id, amount, status
Document        id, client_id (FK), filename, storage_url, uploaded_at
ActionPlan      id, client_id (FK), consultation_id (FK), content, created_at
Message         id, client_id (FK), sender_role, body, created_at
```

No Postgres instance provisioned yet. Recommended: Vercel Postgres or Supabase (both
free-tier, both simple to connect to serverless functions) when Phase 2 payments work
is extended into actual booking/webhook handling.

---

## 9. Decision Log (so past reasoning isn't relitigated)

- **Ecosystem-first vs. product-first:** explicitly rejected building all 14 ecosystem
  components in parallel. One thing (the website + payment flow) proven first.
- **AI Assistant sequencing:** deliberately last (Phase 6), not first — an AI assistant
  with no real client data yet is a chatbot, not a product.
- **Mobile app sequencing:** only after the web client portal is proven — building
  mobile against an unstable backend means rebuilding it twice.
- **Testimonials/stats:** never fabricated. General honest language used instead until
  real, provable outcomes exist (founder confirmed early free clients existed but chose
  not to publish specific numbers/quotes without something in writing).
- **Logo tagline correction:** confirmed with founder before editing ("CREATING HONEST
  ECONOMIC WEALTH" replacing an outdated tagline) rather than guessed.
- **Falling-money/luxury imagery:** proposed once by founder, talked through, not built —
  see Section 2.

---

## 10. Phased Roadmap

1. **Website** — done, deployable.
2. **Payments & Booking** — fully coded (scheduling, Stripe, webhook, reminders).
   Needs: Vercel deployment + Postgres + Resend + Stripe webhook configuration
   (all documented step-by-step in README.md). No more code required for this phase.
3. **Client Portal** — needs auth (Clerk recommended) provisioned. Database already
   exists once Phase 2 setup is done — the `bookings` table can be extended rather
   than starting from scratch.
4. **Admin Dashboard** — needs Client Portal's data layer.
5. **Mobile App** — needs Client Portal proven out first.
6. **AI Assistant** — needs real client/consultation data to be more than a chatbot.

Marketing infrastructure (SEO, blog, email automation, referral program) is real and
valuable but intentionally not competing for engineering time against Phases 2–4.

---

## 11. Standing Instructions for Any Future Claude Session

- Read this file before proposing anything. Don't re-litigate settled decisions in
  Section 9 without a clear reason.
- Don't redesign the logo or brand colors/type without explicit founder request.
- Don't fabricate stats, testimonials, or claims of accomplishments that haven't happened.
- Don't skip ahead in the roadmap sequence without flagging the tradeoff first.
- Update this file whenever a phase changes status — this document is only useful if
  it stays current.
