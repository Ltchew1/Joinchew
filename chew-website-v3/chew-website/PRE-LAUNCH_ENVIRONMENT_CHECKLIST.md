# Pre-Launch Environment Variable Checklist

Every environment variable actually referenced by this codebase's `api/`
and `lib/` source (verified by direct repo search, not inferred from
memory), classified by what breaks without it. **Names and purpose
only — no secret values appear in this file or should ever be committed
to the repo.** Set all of these in Vercel → Project Settings →
Environment Variables, scoped to the correct environment (Preview vs.
Production have independent values in Vercel).

---

## REQUIRED BEFORE DEPLOY (nothing works without these)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (`lib/db.js`). Every API route that touches the database fails immediately without this. |
| `SITE_URL` | This site's own base URL, used to build every link this app puts in an email or a Stripe redirect (recommendation links, sign-agreement links, Deal Sheet, checkout success/cancel URLs, admin deep links). Wrong value breaks every outbound link, not just one page. |

## REQUIRED FOR ADMIN

| Variable | Purpose |
|---|---|
| `CLERK_SECRET_KEY` | Server-side Clerk session verification (`lib/admin-auth.js`) — every admin-authed API route (`requireAdmin`) fails closed (503) without this. This is the real admin auth boundary; there is no working admin panel without it. |
| `CLERK_PUBLISHABLE_KEY` | Served to the browser by `api/admin-auth-config.js` so `admin-applications.html` can initialize Clerk's sign-in widget. Without it, the admin login screen itself cannot load. |
| `ADMIN_CLERK_USER_ID` | The one Clerk user id authorized as CHEW's admin identity (`lib/admin-auth.js`) — `requireAdmin` returns 503 without this even if `CLERK_SECRET_KEY` is set. |
| `ANTHROPIC_API_KEY` | AI admissions triage scoring (`lib/scoring.js`). **Degrades gracefully, does not block launch**: `api/submit-application.js` catches a scoring failure and stores it as `ai_error` on the application row — the application still submits, the admin can still manually decide without a score. Missing this means every new application arrives unscored, not that submissions fail. |
| `ADMIN_NOTIFICATION_EMAIL` | Where every internal/admin-facing notice (new application, scope-review request, payment failure escalation, etc.) is actually delivered (`lib/email.js`). Falls back to a hardcoded `leroyt@joinchew.com` if unset — **set this explicitly rather than relying on the fallback**, so the destination is an intentional choice, not a default nobody reviewed. |
| `ADMIN_SECRET`, `ADMIN_ALLOW_LEGACY_SECRET` | **Legacy, deprecated.** The pre-Clerk shared-secret admin bridge (`lib/admin-auth.js`), explicitly disabled outright when `VERCEL_ENV === 'production'` regardless of these being set — this path cannot function in production no matter what. `ADMIN_SECRET` alone is also read directly by the unrelated `api/log-complaint.js` (a separate, older feature) as its own auth gate. Classify as OPTIONAL / FUTURE for the Recommendation Engine candidate; only set if `api/log-complaint.js` is in active use and only in non-production environments for the legacy admin path. |

## REQUIRED FOR PAYMENT

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Every Stripe API call (`lib/`, `api/create-program-checkout-session.js`, `api/create-remainder-checkout-session.js`, `api/stripe-webhook.js`). Use the **test-mode** key until `STRIPE_TEST_MODE_CHECKLIST.md` is fully executed; swap to the **live-mode** key only at actual go-live. |
| `STRIPE_WEBHOOK_SECRET` | Verifies the incoming webhook signature (`api/stripe-webhook.js`) — without it, either every webhook is rejected (if verification is enforced, which it is) or, if ever bypassed, webhook payloads would be trusted unverified. Must match the signing secret for the **specific** webhook endpoint configured in the Stripe Dashboard for the environment in use — a test-mode secret does not verify live-mode events or vice versa. |
| `STRIPE_PRICE_MEMBERSHIP_ENTRY`, `STRIPE_PRICE_MEMBERSHIP_RECURRING` | Pre-created Stripe Price object ids for the Membership entry fee + recurring charge (`api/create-program-checkout-session.js`'s `tier === 'membership'` branch, `lib/programs.js`). **Not required for initial launch** — see MEMBERSHIP REMINDER DEADLINE in the certification report; Membership is unreachable through the current recommendation-engine flow until a client completes an engagement + 30-day Continuity. Needed only before the first client can actually reach that transition. |
| ~~`STRIPE_PRICE_FOCUSED_BUILDER_FULL`~~, ~~`STRIPE_PRICE_INFRASTRUCTURE_FULL`~~, ~~`STRIPE_PRICE_ADVANCED_INFRASTRUCTURE_FULL`~~, ~~`STRIPE_PRICE_EXECUTIVE_FULL`~~ | **Dead references — do not need to be set.** Defined as data in `lib/programs.js` (`entryPriceEnv` per one-time tier) but never actually read: the one-time-tier checkout branch in `api/create-program-checkout-session.js` builds its Stripe line item from inline `price_data` (dynamic pricing), never from a pre-created Price object, for any of the 4 one-time tiers. Confirmed by direct code read, not assumed. |

## REQUIRED FOR EMAIL

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Every transactional email in `lib/email.js` — application receipts, decision emails, recommendation-ready, payment confirmations/failures, admin notices, reminders. Missing this means every email send throws (caught individually per call site; each failure is logged and, where a claim-before-send column exists, safely retryable — never blocks the underlying action it's attached to). |
| `FROM_EMAIL` | The sending address/display name for every email `lib/email.js` sends. Must be a domain verified in Resend, or sends will fail even with a valid API key. |

## REQUIRED FOR CRON

| Variable | Purpose |
|---|---|
| `CRON_MANUAL_SECRET` | The shared secret for manually invoking `api/send-recommendation-reminders.js` (and `api/send-membership-reminders.js`, once that job is wired) outside of Vercel's own scheduled trigger — required to run the go-live cron verification steps in `PRODUCTION_DB_MIGRATION_RUNBOOK.md`. The real scheduled invocation itself needs no secret; Vercel's own `x-vercel-cron` header is the production auth path and requires no environment variable at all. |

## OPTIONAL / FUTURE

| Variable | Purpose |
|---|---|
| `PORTAL_URL` | Link to the separate CHEW client portal (`lib/clerk.js`). Has a working hardcoded fallback (`https://chew-portal-gzpr.vercel.app`) — only set this to override that default. |
| `VERCEL_ENV` | Set automatically by Vercel on every deployment (Preview/Production/Development) — never configure this manually. Read by `lib/admin-auth.js` solely to hard-disable the legacy admin secret path in production. |

---

## Not yet applicable to this candidate

Env vars referenced elsewhere in this repo for features outside the
commercial admissions → recommendation → payment funnel (the Path
Engine / Capability Network / Intelligence Demo systems, the original
consultation-booking flow) are out of scope for this checklist and are
not enumerated here — they don't gate the Recommendation Engine
candidate's launch.
