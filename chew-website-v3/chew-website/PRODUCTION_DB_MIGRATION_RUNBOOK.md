# Production Database Migration Runbook

**Do not deploy any API code from this branch to production before this
runbook has been executed against the production database and every
verification query below returns the expected result.** This document
does not claim the production database is ready — it has not been
executed from this session (no production database credentials exist
here) — it specifies exactly what "ready" means and how to prove it.

## Correction on `feature_flags`

An earlier report in this engagement said `feature_flags` was "pre-
existing on `main`, unchanged by any of these branches" and implied no
action was needed. **That was a repository-source-code observation, not a
production-database fact, and it was wrong to treat them as equivalent.**
The user confirmed production is currently returning
`relation "feature_flags" does not exist` from both `/api/feature-flags`
and `/api/intelligence-demo`. The table existing in `db/schema.sql` proves
intent, not deployment. This runbook treats database reality as the only
source of truth from here on, and includes `feature_flags` explicitly —
along with its required seed data (`db/seed-feature-flags.sql`), which is
easy to miss even after the table itself is created, since
`/api/intelligence-demo` depends on a specific seeded row
(`intelligence_demo`, `status = 'live'`) existing, not merely on the table
existing.

## Before migration

1. **Take a database backup / restore point.** If the production Postgres
   provider supports point-in-time recovery or a one-click snapshot
   (Vercel Postgres, Supabase, RDS, etc. all do), take one immediately
   before running anything below. Record the restore point's timestamp/id
   somewhere retrievable.
2. Confirm `DATABASE_URL` in the migration session points at production,
   not staging — verify with a read-only query first
   (`SELECT current_database();`) rather than trusting the env var name.

## Migration (run `db/schema.sql` in full, top to bottom)

The entire file is additive and idempotent — every `CREATE TABLE` uses
`IF NOT EXISTS`, every `ALTER TABLE ... ADD COLUMN` uses
`IF NOT EXISTS`, and every widened `CHECK` constraint uses the established
`DROP CONSTRAINT IF EXISTS` + re-`ADD CONSTRAINT` pattern — so running the
complete current file against a database that already has some (but not
all) of these objects is safe and will simply skip what already exists.
**Do not hand-pick a subset of statements to run** — run the whole file,
then verify individually per the section below. In dependency order (this
is already the file's own top-to-bottom order, listed here for visibility):

1. `applications.internal_note`, `applications.applicant_message` columns
   + the one-time `UPDATE ... WHERE applicant_message IS NULL` backfill.
2. `idx_program_purchases_entry_session` index.
3. Entry/remainder notification timestamp columns on `program_purchases`.
4. Agreement evidence columns on `agreement_signatures`
   (`agreement_read_and_accepted`, `agreement_content_hash`, the four
   original `*_at_signing` columns, `agreement_snapshot_html`,
   `owner_agreement_notified_at`, `client_agreement_notified_at`).
5. Widened `program_purchases_tier_check` and
   `agreement_signatures_tier_check` (5 tiers).
6. Widened `program_purchases_status_check` (adds `'active'`).
7. Payment-plan snapshot columns on `agreement_signatures`
   (`payment_plan_type_at_signing`, `total_contract_amount_at_signing`,
   `initial_payment_amount_at_signing`, `installment_amount_at_signing`,
   `installment_count_at_signing`).
8. Payment-plan + notification columns on `program_purchases`
   (`payment_plan_type`, `total_contract_amount_cents`,
   `initial_payment_amount_cents`, `installment_amount_cents`,
   `installment_count`, `installments_paid`,
   `stripe_subscription_schedule_id`, `initial_payment_paid_at`,
   `next_payment_due_at`, `paid_in_full_at`, `payment_plan_status`, and
   the six `*_notified_at` columns for initial/paid-in-full/failed ×
   customer/owner).
9. `program_purchase_installments` table + its purchase-id index.
10. **`feature_flags` table** (pre-existing in the file, confirmed
    missing in production — see correction above).
11. **Run `db/seed-feature-flags.sql` immediately after** — the table
    alone is not sufficient; `/api/intelligence-demo` needs its seeded
    `intelligence_demo` row present with `status = 'live'`.

## After migration — verify individually (do not stop at "the file ran without error")

Run each of these against production and confirm the result matches
before deploying any code that depends on it:

```sql
-- 1. Every new column on applications
SELECT column_name FROM information_schema.columns
WHERE table_name = 'applications' AND column_name IN ('internal_note', 'applicant_message');
-- expect: 2 rows

-- 2. New index
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_program_purchases_entry_session';
-- expect: 1 row

-- 3. Agreement evidence columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'agreement_signatures'
  AND column_name IN ('agreement_read_and_accepted', 'agreement_content_hash',
    'agreement_snapshot_html', 'owner_agreement_notified_at', 'client_agreement_notified_at',
    'payment_plan_type_at_signing', 'total_contract_amount_at_signing',
    'initial_payment_amount_at_signing', 'installment_amount_at_signing',
    'installment_count_at_signing');
-- expect: 10 rows

-- 4. Widened tier constraints (both tables) -- confirm all 5 tiers are accepted
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname IN ('program_purchases_tier_check', 'agreement_signatures_tier_check');
-- expect: 2 rows, each definition containing 'focused_builder' AND 'advanced_infrastructure' AND 'executive' AND 'membership'

-- 5. Widened status constraint -- confirm 'active' is accepted
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'program_purchases_status_check';
-- expect: 1 row, definition containing 'active'

-- 6. Payment-plan + notification columns on program_purchases
SELECT column_name FROM information_schema.columns
WHERE table_name = 'program_purchases'
  AND column_name IN ('payment_plan_type', 'total_contract_amount_cents',
    'initial_payment_amount_cents', 'installment_amount_cents', 'installment_count',
    'installments_paid', 'stripe_subscription_schedule_id', 'initial_payment_paid_at',
    'next_payment_due_at', 'paid_in_full_at', 'payment_plan_status',
    'initial_payment_customer_notified_at', 'initial_payment_owner_notified_at',
    'payment_failed_customer_notified_at', 'payment_failed_owner_notified_at',
    'paid_in_full_customer_notified_at', 'paid_in_full_owner_notified_at');
-- expect: 17 rows

-- 7. program_purchase_installments table + index + unique constraint
SELECT table_name FROM information_schema.tables WHERE table_name = 'program_purchase_installments';
-- expect: 1 row
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_program_purchase_installments_purchase';
-- expect: 1 row
SELECT conname FROM pg_constraint
WHERE conrelid = 'program_purchase_installments'::regclass AND contype = 'u';
-- expect: 1 row (the UNIQUE constraint on stripe_invoice_id)

-- 8. feature_flags table AND its seed data
SELECT table_name FROM information_schema.tables WHERE table_name = 'feature_flags';
-- expect: 1 row
SELECT slug, status, public_teaser_enabled FROM feature_flags ORDER BY slug;
-- expect: 12 rows total (see db/seed-feature-flags.sql), including
-- slug='intelligence_demo' with status='live'
```

Only once every query above returns its expected result:

12. Hit `/api/feature-flags` and `/api/intelligence-demo` directly against
    production (curl or browser) and confirm neither returns a `relation
    ... does not exist` error and both return the expected JSON shape.
13. Only then deploy the application code from this branch that reads the
    new columns/tables (`api/stripe-webhook.js`,
    `api/create-program-checkout-session.js`, `api/sign-agreement.js`,
    etc.) — deploying code before the schema exists is the exact ordering
    mistake this runbook exists to prevent.

## What this runbook does not cover

This is a schema/data migration runbook only. It does not cover
environment variable configuration (Stripe keys, webhook secrets — see
`STRIPE_TEST_MODE_CHECKLIST.md`), DNS/domain configuration, or the actual
code deployment step itself (assumed to be the existing Vercel deploy
pipeline). It also does not second-guess whether `main`'s current schema
state matches what's assumed above — the additive/idempotent design means
re-running the full file is safe regardless, but if production has
diverged from `main` in some undocumented way, the verification queries
above are what catches that, not an assumption that "should be fine."
