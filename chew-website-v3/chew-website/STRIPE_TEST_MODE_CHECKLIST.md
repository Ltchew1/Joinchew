# Stripe Test-Mode Certification Checklist

**Status: NOT executed. This environment has no Stripe credentials.**
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are only present as
placeholder values in `.env.example` (`sk_live_replace_this_in_vercel_only`
/ `whsec_replace_this_in_vercel_only`); no real test-mode key exists in this
session. Per instruction, this is not pretended to have run — everything
below is the exact operator sequence to execute this for real, with what
to check at each step. 111/170 assertions cited elsewhere in this pass are
all against a *mocked* Postgres, not live Stripe — this checklist is the
remaining, separate gate.

## Setup (one time)

1. In the Stripe Dashboard, switch to **Test mode** (toggle, top right).
2. Developers → API keys → copy the test **Secret key** (`sk_test_...`).
3. Developers → Webhooks → Add endpoint → point it at a reachable test URL
   for this app (a Vercel preview deployment URL, or `stripe listen --
   forward-to localhost:3000/api/stripe-webhook` for local testing) →
   select events: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_succeeded`,
   `invoice.payment_failed` → copy the **Signing secret** (`whsec_...`).
4. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (test-mode values) in
   the deployment's environment (Vercel preview env vars, or local `.env`).
   `DATABASE_URL` must point at a real (test/staging) Postgres with the
   full `schema.sql` applied — see `PRODUCTION_DB_MIGRATION_RUNBOOK.md`.
5. Use Stripe's documented test cards throughout: `4242 4242 4242 4242`
   (any future expiry, any CVC) for a successful charge;
   `4000 0000 0000 0341` for a card that's valid at Checkout but fails on
   the *next* off-session charge (this is the specific card needed to test
   Monthly Plan installment failure — see step 8 below); `4000 0000 0000 9995`
   for an immediate decline.

## Sequence A — Pay in Full

1. Run the full applicant journey: Make Your Move → owner notification
   email → applicant receipt email → admin review/accept → select
   engagement (any one-time tier) → Pay in Full → sign agreement → Deal
   Sheet → Stripe Checkout with `4242 4242 4242 4242`.
2. Confirm in Stripe Dashboard (test mode): one Checkout Session,
   `payment_status: paid`, one PaymentIntent.
3. Confirm in the database: `program_purchases.initial_payment_paid_at` and
   `paid_in_full_at` both set (same timestamp), `payment_plan_status =
   'paid_in_full'`, `stripe_customer_id` populated.
4. Confirm exactly one customer "payment received" email, one customer
   "paid in full" email, one owner enrollment email — check Resend's
   dashboard or logs for delivery, not just that the API call didn't throw.
5. Confirm `booking-confirmed.html` shows correct state from the
   authoritative purchase-status API, not from URL params alone.

## Sequence B — Monthly Plan: initial payment, future first installment

1. Same journey as A, but choose Monthly Plan, pay the initial amount with
   `4242 4242 4242 4242`.
2. Confirm the Checkout Session used `payment_method_types: ['card']` only
   (inspect the session object in Stripe Dashboard) and
   `setup_future_usage: 'off_session'` was set on the PaymentIntent.
3. Confirm in Stripe Dashboard: a Subscription Schedule was created
   (Billing → Subscription schedules), `status: not_started`,
   `start_date` approximately one calendar month out (verify it lands on
   the correct clamped date if the enrollment date is near month-end —
   see the exact rule in `api/stripe-webhook.js`'s `addOneCalendarMonthUnix`).
4. Confirm the schedule's own top-level metadata AND its phase metadata
   both contain `chew_purchase_id` and `kind: 'chew_program_installment_plan'`
   (the reconciliation layer in `findOrCreateInstallmentSchedule` reads the
   top-level field; Stripe copies the phase-level field onto the
   Subscription and then onto every invoice, which is what the separate
   `invoice.payment_succeeded`/`invoice.payment_failed` handler's lookup
   depends on).
5. Confirm in the database: `initial_payment_paid_at` set,
   `stripe_subscription_schedule_id` populated, `payment_plan_status =
   'current'`, `next_payment_due_at` matches the schedule's `start_date`.
6. **This is the step that requires waiting or a Stripe Test Clock.**
   Real time: wait for the schedule's `start_date` to arrive (impractical
   for a checklist). Preferred: use a **Stripe Test Clock**
   (Dashboard → Developers → Test clocks, or the API) to advance test-mode
   time past `start_date` without waiting — Test Clocks are Stripe's own
   mechanism for exactly this kind of test and should be used here rather
   than a real-time wait.
7. Once the clock advances past `start_date`: confirm the Subscription
   Schedule transitioned to `active`, a real Subscription now exists, and
   an Invoice was generated and paid using the saved card — confirm this
   is the *exact* payment method from step 1 (via `default_payment_method`
   on the schedule), not an ambiguous customer default.
8. Confirm `invoice.payment_succeeded` fired, the webhook returned 200,
   `installments_paid` incremented to 1, `program_purchase_installments`
   has one row for that invoice, and exactly one installment-received
   email sent.

## Sequence C — middle installment, failure, automatic retry, cure

1. Advance the Test Clock again to the next installment date.
2. **Before** advancing, swap the customer's default payment method to
   `4000 0000 0000 0341` (a card that Stripe will decline specifically on
   off-session charges) to force a realistic failure.
3. Advance the clock. Confirm `invoice.payment_failed` fires, webhook
   returns 200, `payment_plan_status = 'payment_failed'`,
   `program_purchase_installments` has a `'failed'` row for that invoice,
   one failed-payment customer email and one owner escalation email sent.
4. Confirm Stripe's own automatic retry schedule is visible on the invoice
   (Dashboard shows next retry date).
5. Swap the payment method back to `4242 4242 4242 4242` (simulating the
   client updating their card) **before** the next automatic retry fires
   (or manually trigger a retry via the Dashboard/API if waiting for
   Stripe's own schedule is impractical).
6. Confirm the retry succeeds against the **same invoice id** (Stripe's
   actual retry behavior — it does not create a new invoice). Confirm
   `invoice.payment_succeeded` for that same invoice id transitions the
   installment ledger row from `'failed'` to `'paid'` (the cure logic
   added this pass), `installments_paid` increments, `payment_plan_status`
   returns to `'current'`, and — critically — confirm **no new failed
   notice was sent** for this same invoice after the cure, and confirm the
   customer receives the installment-paid notice.

## Sequence D — final installment, automatic termination

1. Advance the Test Clock through the remaining installments (all paid
   with the working card) up to and including the final one.
2. On the final installment's success: confirm `installments_paid ===
   installment_count`, `paid_in_full_at` set once, `payment_plan_status =
   'paid_in_full'`, exactly one paid-in-full customer email and one
   paid-in-full owner email.
3. Confirm in Stripe Dashboard: the Subscription Schedule's status is
   `completed` (its `end_behavior: 'cancel'` should have canceled the
   underlying Subscription automatically).
4. Advance the Test Clock one more billing cycle past completion. Confirm
   **no new invoice is generated** (this is the literal "no N+1 invoice"
   check) — the schedule should not still be billing.

## Sequence E — hostile/duplicate webhook replay

1. In Stripe Dashboard, find any of the events delivered above (Developers
   → Webhooks → your endpoint → Events) and use **Resend** to redeliver it.
2. Confirm the redelivered event is a no-op: no duplicate DB row, no
   duplicate email, and the webhook returns 200 (not 500) since nothing
   was actually incomplete this time.
3. Specifically replay a `checkout.session.completed` for the Monthly Plan
   enrollment (Sequence B step 1's event) a second time — confirm no
   second Subscription Schedule is created (the idempotency key added this
   pass, `plan-schedule:<purchase_id>`, should make Stripe return the
   original schedule).

## Sequence F — schedule-creation persistence-failure / automatic-retry

This is the hardest to force live (it requires making the local DB write
fail *after* Stripe's schedule-creation call succeeds) and is the one
scenario already proven thoroughly in the mocked test suite
(`test-webhook-plan-payment-durability.js`, scenario 2b — 9 assertions).
Live-fire approximation: temporarily point `DATABASE_URL` at an
unreachable host, trigger a Monthly Plan enrollment, observe the webhook
return non-2xx, restore `DATABASE_URL`, and use Stripe's Dashboard
**Resend** on that event (simulating Stripe's own automatic retry) to
confirm the same idempotency key returns the same schedule and the DB
converges to the correct state. Given the mocked coverage is already
rigorous here, this live sequence is lower-priority than A–E.

## What to explicitly confirm at every sequence above

- **Client email** — actually received (Resend delivery log), correct
  subject, correct amounts.
- **Owner email** — actually received at the configured
  `ADMIN_NOTIFICATION_EMAIL` (or the `leroyt@joinchew.com` fallback).
- **DB state** — queried directly, not inferred from the UI.
- **Stripe state** — Checkout Session, PaymentIntent, Customer,
  PaymentMethod, Subscription Schedule, Subscription, and Invoice objects
  all inspected directly in the Dashboard. None of these ids are ever
  exposed to the client-facing UI (confirm this too, e.g. by checking
  `booking-confirmed.html`'s network requests contain no raw Stripe ids).

**No launch certification should be issued from mocked tests alone.**
Sequences A–D are the minimum bar; E and F harden confidence further.
