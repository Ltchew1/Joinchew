# CHEW LLC — Architecture & Implementation Roadmap
**v1.1 — Three-tier pricing live, Stripe integration in progress, brand mark added**

---

## 1. Current Status

- **Corporate website:** complete, 13 pages including the booking-confirmed page.
- **Brand:** real CHEW icon mark (circular badge, ascending gold/steel-blue bars)
  now live in the header and footer of every page — replacing the placeholder.
- **Services & pricing:** three real tiers — CHEW Strategy Session ($97/25 min),
  CHEW Growth Strategy Session ($197), CHEW Executive Strategy Session ($297).
- **Payments:** Stripe account is set up. Checkout code is written and ready to deploy
  (`/api/create-checkout-session.js`) — goes live once deployed on Vercel with real
  environment variables set (see `.env.example`).
- **Domain:** joinchew.com, owned and correctly referenced site-wide.

## 2. Recommended Architecture

Next.js (React + TypeScript) · Tailwind · PostgreSQL · Prisma · Stripe · Clerk (auth) ·
cloud object storage · Resend (email) · Vercel (hosting + serverless functions).

The static site deploys as-is on Vercel today, and `/api` already follows Vercel's
serverless function convention — migrating to full Next.js later is incremental,
not a rewrite.

## 3. What "done" looks like for Phase 2 (Payments)

1. Three Stripe Products created, each with one Price (the $97/$197/$297 tiers).
2. Environment variables set in Vercel (never in the codebase): `STRIPE_SECRET_KEY`,
   `STRIPE_PRICE_STRATEGY`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_EXECUTIVE`, `SITE_URL`.
3. Site deployed to Vercel (not Netlify Drop / GitHub Pages — those don't run
   serverless functions).
4. Test with a Stripe test-mode card before switching to live keys.

## 4. Immediate next engineering steps, in order

1. **Webhook handling** — a successful payment redirects the client to a confirmation
   page, but CHEW's systems aren't notified server-side yet. Add a Stripe webhook
   (`checkout.session.completed`) so a client record and appointment get created
   automatically.
2. **Actual appointment scheduling** — payment works, but there's no calendar/time-slot
   selection yet. This is the next real gap between "payment works" and "booking works."
3. **Client record creation** — tie each payment to a client record (see schema below)
   so the admin dashboard has real data once it's built.

## 5. Database Schema (Core Entities, unchanged from v1.0)

```
User            id, email, role (client/admin), created_at, auth_provider_id
Client          id, user_id (FK), name, phone, onboarding_status
Consultation    id, client_id (FK), type, status, price_id, scheduled_at
Payment         id, consultation_id (FK), stripe_payment_id, amount, status
Document        id, client_id (FK), filename, storage_url, uploaded_at
ActionPlan      id, client_id (FK), consultation_id (FK), content, created_at
Message         id, client_id (FK), sender_role, body, created_at
```

## 6. Security & Compliance Reminders

- Never commit real Stripe keys to any file, repo, or chat.
- Stripe Checkout (hosted) keeps CHEW out of PCI scope — don't build a custom card form.
- Three specific dollar amounts are now real, binding claims once live — confirm Stripe
  is configured to charge exactly $97/$197/$297 before going live.

## 7. Phased Roadmap (unchanged from v1.0)

Phase 1 (done): website. Phase 2 (in progress): payments. Phase 3: client portal.
Phase 4: admin dashboard. Phase 5: mobile app. Phase 6: AI assistant — built last,
once there's real client data for it to work with.
