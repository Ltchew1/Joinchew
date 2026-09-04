# CHEW Client Portal — Integration Requirements

Status: requirements only. **No portal behavior is implemented in this repository.**
The CHEW Client Portal is a separate application. This document describes the data
this repository (the marketing site + commercial backend) already owns and can
expose, and the states a portal integration would need to represent honestly. It
does not invent, assume, or describe any portal screen, workflow, or feature —
where the portal's actual behavior is unknown, this document says so instead of
guessing.

Written against the commercial architecture locked in `BUSINESS DECISIONS APPROVED`
(engagement/pricing matrix, monthly-payment model, Continuity/Membership doctrine)
and the schema in `db/schema.sql` as of this pass on `preview/contract-agreement-intelligence`.

---

## 1. What this repository is authoritative for

This repository (and its Postgres database) is the **source of truth** for:

- Application/admissions state (`applications`)
- Signed Client Services Agreements, including the exact text/hash/snapshot signed
  (`agreement_signatures`)
- Commercial terms — engagement scope, pricing, payment plan (`lib/programs.js`,
  `lib/agreementText.js`, `lib/agreementRegistry.js`)
- Payment truth — what Stripe actually confirmed, not what the browser claims
  (`program_purchases`, `program_purchase_installments`, driven exclusively by
  `api/stripe-webhook.js`)
- Membership subscription status as reported by Stripe (`program_purchases.membership_status`)
- The My Position / Playbook / Lab data model (`goals`, `current_state_facts`,
  `constraints`, `recommendations`, `actions`, `scenarios`, `leverage_items`,
  `state_snapshots` — pre-existing, not created by this pass)

The portal is expected to be a **read/consume** integration against this data,
not a second source of truth for payment or contract state. If the portal needs
to originate an action (e.g., a client requesting a New Move, or cancelling
Membership), that write should route back through this backend's APIs so the
webhook-verified payment truth and the single commercial-terms source are never
forked.

---

## 2. Engagement & scope — what the portal should show

**Source:** `program_purchases.tier`, joined against `lib/programs.js` (via a new
read API — none exists yet, see §9).

For a client with a `program_purchases` row, the portal can determine:

| Field | Source | Notes |
|---|---|---|
| Engagement tier | `program_purchases.tier` | `focused_builder`, `infrastructure`, `advanced_infrastructure`, `executive`, or `membership` |
| Engagement label | `lib/programs.js: PROGRAMS[tier].label` | e.g. "Advanced Infrastructure" |
| Session count | `PROGRAMS[tier].sessionCount` | One-time tiers only |
| Duration (days) | `PROGRAMS[tier].durationDays` | Counted from... not yet defined (see §9 — "engagement start date" is not a tracked fact today) |
| Document review events allotted | `PROGRAMS[tier].documentReviewEvents` | See `lib/agreementText.js` `KEY_TERMS.documentReviewLimit` for what one "event" means |
| Document review events used | **Not tracked** | Flagged in §9 |
| Deliverable name | `PROGRAMS[tier].deliverable` (one-time tiers) | e.g. "Full Financial Blueprint + Position Map + Sequenced Action Plan" |
| Advisory access description | `PROGRAMS[tier].advisoryAccess` | Free text, contract-exact wording |
| Signed agreement snapshot | `agreement_signatures.agreement_snapshot_html` | The literal HTML the client signed — exact, immutable |
| Signed agreement content hash | `agreement_signatures.agreement_content_hash` | SHA-256, for tamper-evidence display if desired |

**Honest gap:** there is no "engagement started on X, ends on Y" date pair in the
schema today. `durationDays` is a contract term (a ceiling on how long the
engagement runs), not a computed portal fact. If the portal needs to show "42 of
90 days remaining," a start-date column (most naturally `initial_payment_paid_at`
or a new `engagement_started_at`) plus a computed end date needs to be agreed and
added — not invented here.

---

## 3. Payment plan — what the portal should show

**Source:** `program_purchases` (new payment-plan columns added this pass) +
`program_purchase_installments`.

| Field | Column | Notes |
|---|---|---|
| Plan type | `payment_plan_type` | `pay_in_full` or `monthly`; `NULL` for Membership (Membership is not a program payment plan) |
| Total contract amount | `total_contract_amount_cents` | Snapshotted at signing, matches what was charged |
| Initial payment amount | `initial_payment_amount_cents` | |
| Installment amount | `installment_amount_cents` | `NULL` for `pay_in_full` |
| Installment count | `installment_count` | Total number of monthly installments after the initial payment; `NULL` for `pay_in_full` |
| Installments paid | `installments_paid` | Incremented only on a webhook-verified `invoice.payment_succeeded` |
| Plan status | `payment_plan_status` | `current`, `payment_failed`, `retrying`, `past_due`, `paused`, `cured`, `paid_in_full`, `cancelled` — see §3a below, not all values are wired by code today |
| Initial payment date | `initial_payment_paid_at` | |
| Paid-in-full date | `paid_in_full_at` | Set immediately for `pay_in_full`; set when `installments_paid >= installment_count` for `monthly` |
| Next payment due | `next_payment_due_at` | Set once, at initial payment, to the first scheduled installment date. **Not updated per-installment today** — see §9 |
| Per-installment ledger | `program_purchase_installments` (`stripe_invoice_id`, `amount_cents`, `status`, `created_at`) | One durable row per Stripe invoice event, `paid` or `failed` |

### 3a. `payment_plan_status` — which values are actually reachable today

The CHECK constraint allows 8 values. As of this pass, `api/stripe-webhook.js`
only ever sets: `current`, `payment_failed`, `paid_in_full`. The values
`retrying`, `past_due`, `paused`, `cured`, `cancelled` exist in the schema for
future operational nuance (e.g., distinguishing "Stripe is auto-retrying" from
"grace period expired, access should pause") but **no code sets them yet**. A
portal should not assume it will ever see those values today, and should treat
an unrecognized value defensively (show it plainly, don't crash) rather than
assuming the enum is exhaustively wired.

**Honest gap:** the agreement text (`lib/agreementText.js`, Section 3.5)
describes a grace period and an access pause after a Monthly Plan payment stays
unresolved — but no code currently transitions `payment_plan_status` into
`past_due` or `paused`, and nothing currently pauses portal/service access on a
failed payment. That enforcement does not exist yet. If access-pausing is a
portal requirement, it needs to be built (likely: a scheduled job or webhook
follow-up that promotes `payment_failed` to `past_due` after N days unresolved,
and a corresponding portal read of that state) — not assumed from this document.

---

## 4. Payment status — single source of truth

The portal must **never** treat a Stripe Checkout redirect, a client-side
"success" URL param, or anything the browser reports as authoritative for
payment. The only authoritative payment facts are the ones `api/stripe-webhook.js`
writes after Stripe itself confirms the event server-to-server:

- `entry_paid_at` / `remainder_paid_at` — legacy one-time model (Infrastructure/
  Executive under the old entry+remainder scheme; still live for older purchases)
- `initial_payment_paid_at` / `paid_in_full_at` / `installments_paid` — current
  payment-plan model
- `membership_status` — Membership subscription state, synced from Stripe's
  `customer.subscription.updated`/`deleted` events

If the portal needs a "has this client paid enough to access X" check, it should
call a backend read endpoint (see §9) that evaluates these columns server-side —
not replicate the logic client-side against raw webhook columns, and not trust
anything the portal's own client-side session claims about payment.

---

## 5. Service status

**Honest gap — no dedicated "service status" concept exists in the schema today.**
What exists:

- `program_purchases.status`: `pending_entry`, `pending_remainder`, `complete`,
  `active` (the last value added this pass for the payment-plan model)
- No column distinguishes "engagement is being actively delivered" from
  "engagement is paid but sessions haven't started" from "engagement is
  functionally finished but not yet marked complete"

Per the locked doctrine, **paid-in-full and service-complete are separate
facts** — a client can be paid in full while sessions are still being delivered,
or (less commonly) have all sessions delivered while a Monthly Plan still has
installments outstanding. This repository currently tracks the payment side of
that split (`paid_in_full_at`) but has **no column for service/delivery
completion**. If the portal needs to show "your engagement is complete" as a
fact distinct from "you're paid in full," that column (most naturally
`service_completed_at` on `program_purchases`, likely set by an admin action
rather than automatically) does not exist yet and needs to be designed and
approved before the portal can rely on it.

---

## 6. CHEW Continuity state

Per locked doctrine: 30 days included after engagement completion, no additional
charge, no automatic paid Membership enrollment.

**Honest gap — Continuity has no tracked state in this schema.** There is no
`continuity_started_at`, `continuity_ends_at`, or equivalent. Continuity's start
depends on "engagement completion," which (per §5) is itself not a tracked fact
yet. Until service-completion tracking exists, Continuity cannot be computed
server-side, and the portal cannot be told an authoritative Continuity window —
any such window is currently a business-process fact enforced by the CHEW team,
not a `state_derived` value.

---

## 7. Membership state

**Source:** `program_purchases` rows where `tier = 'membership'`.

| Field | Column | Notes |
|---|---|---|
| Subscription status | `membership_status` | `trialing`, `active`, `paused`, `cancelled` — synced live from Stripe |
| Stripe subscription id | `stripe_subscription_id` | **Shared column with the payment-plan model** — see warning below |
| First charge date | `membership_first_charge_at` | |
| Entry fee paid | `entry_paid_at` | Membership uses the legacy entry+recurring model, not the new payment-plan columns |

**Important integration warning:** `stripe_subscription_id` is populated for
*both* Membership subscriptions and Monthly Plan program purchases (the latter's
Subscription Schedule eventually creates a real Stripe Subscription once its
first phase starts). They are disambiguated by `tier = 'membership'` vs.
`payment_plan_type = 'monthly'` — **never** assume a non-null
`stripe_subscription_id` means Membership. `api/stripe-webhook.js`'s
`customer.subscription.updated/deleted` handler already enforces this
distinction server-side (`WHERE ... AND tier = 'membership'`); any portal logic
reading this column directly must apply the same guard.

**Honest gap — "graduate" status does not exist as a queryable fact.** Locked
doctrine: at launch, Membership's $147 entry fee is waived for CHEW graduates
(clients who completed a CHEW engagement). `lib/programs.js` currently sets
`entryFeeWaivedForGraduates: false` deliberately, specifically because there is
no `graduate` determination available — it depends on the same
service-completion tracking flagged missing in §5. This is not silently
implemented anywhere; the code charges the entry fee for everyone today rather
than guessing who "graduated." A portal cannot show graduate-only messaging or
a waived price until that determination exists and is approved.

---

## 8. Records / Vault entitlement

Locked doctrine: ending Membership must not hold legitimate client records
hostage. Former clients retain access to signed agreements, Deal Sheets,
receipts, the completed Blueprint, and historical records; active
intelligence/advisory features may stop, but historical records remain. Internal
notes, AI rationale, raw IP, raw user agent, tokens, and internal database ids
must never be exposed.

What this repository can already provide, safely, regardless of Membership
status:

| Record | Source | Portal-safe fields |
|---|---|---|
| Signed agreement | `agreement_signatures` | `agreement_snapshot_html`, `agreement_version`, `signed_at`, `signed_name`, `tier`, `payment_plan_type_at_signing`, `total_contract_amount_at_signing` |
| Deal Sheet | `lib/agreementRegistry.js: getDealSheetData(tier)` | Everything it returns is already public-safe (no PII, no internal ids) |
| Payment receipts | `program_purchases` (amounts + dates) + `program_purchase_installments` | Amounts, dates, status — never Stripe customer/payment-method/session ids |
| Completed Blueprint | **Not yet a stored artifact** | See honest gap below |

**Never expose, ever, in a portal-facing read:** `applications.internal_note`
equivalents from the admissions schema, `agreement_signatures.ip_address` /
`user_agent`, `stripe_customer_id` / `stripe_subscription_id` /
`stripe_subscription_schedule_id` / any `stripe_*_session_id`, `access_token`,
`id` primary keys as client-facing identifiers (use `access_token` or a
purpose-built opaque portal id instead), or any AI-scoring/rationale internals
from the admissions pipeline.

**Honest gap — there is no stored "Financial Blueprint" document artifact.**
The Blueprint is currently a *deliverable CHEW produces as part of service
delivery* (sessions, advisory, written output), not a generated/stored file in
this database. If "access your completed Blueprint" is a required portal
feature, that requires a storage/authoring decision (where does the document
live, in what format, who authors it, when is it marked final) that has not
been made and is explicitly out of scope for this pass to invent.

---

## 9. Gaps this document deliberately does not resolve

Summarized from above, so nothing is buried:

1. **No engagement start/end date tracking** — needed for "days remaining" (§2).
2. **`payment_plan_status` values `retrying`/`past_due`/`paused`/`cured`/`cancelled` are schema-only, not wired by any code** — needed for real dunning/access-pause behavior (§3a).
3. **`next_payment_due_at` is set once and not refreshed per installment** — a portal showing "next payment on X" would show a stale date after the first installment (§3).
4. **No service/delivery-completion tracking**, distinct from payment completion (§5).
5. **No Continuity window tracking**, which depends on #4 (§6).
6. **No "graduate" determination**, which also depends on #4 (§7) — blocks the approved Membership entry-fee waiver for graduates.
7. **No stored Financial Blueprint document artifact** (§8).
8. **No portal-facing read API exists yet at all** — every field in this document today requires a direct database read; a purpose-built, access-token-scoped (or portal-auth-scoped) API surface needs to be built before the portal can safely consume any of this. This document specifies *what* such an API should expose, not its route shapes, auth model, or implementation — that is portal-team + backend-team design work, not assumed here.

None of these gaps are blockers to the launch-critical marketing/pricing/payment
work approved in this pass — they are portal-scoped follow-up work, flagged
honestly rather than silently implemented or silently ignored.
