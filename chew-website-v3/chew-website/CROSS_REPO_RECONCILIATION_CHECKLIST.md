# CHEW Cross-Repository Intelligence Reconciliation Checklist

**Status: not yet executable.** `chew-portal` (the authenticated member-intelligence
repository) is currently blocked behind a pending permission approval — every
`chew-portal` column below is `TBD` until that access clears. This document is the
comparison matrix to run at that point, not a strategy document. Do not fill in the
`chew-portal` columns from memory or assumption; read the actual code.

**Governing rule (do not relitigate this per-row):** CHEW gets one authoritative
member brain. Website, portal, future iOS/Android are experiences on top of it, not
independent reasoners. Joinchew is public/illustrative; `chew-portal` is presumed to
hold real member state and reasoning. Nothing below authorizes building real member
intelligence in Joinchew — every "MISSING in Joinchew" row is expected and correct
for a public website repo unless the comparison below says otherwise.

**Joinchew columns are already filled in**, from the audit completed 2026-08-29
(see `ARCHITECTURE_REVIEW.md` and this session's transcript for full citations).

## How to run this once portal access clears

For each row: read the actual `chew-portal` code for that capability, fill in its
column, then answer the same six questions for that row before moving to the next.
Do not batch-guess the `chew-portal` column across rows — read each one.

| Capability | Joinchew | chew-portal | Stronger | Authoritative | Share server-side? | Stay client-specific? | Consolidation need | Duplication risk |
|---|---|---|---|---|---|---|---|---|
| Member Facts | `current_state_facts`: raw value + provenance, 1 illustrative subject only | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Provenance | 4-state (`user_provided/verified/computed/inferred`), CHECK-enforced, `source_note` required on `verified` | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Freshness | Exists only for CHEW's own derived artifacts (scenarios/leverage/snapshots); raw facts have no staleness field | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Conflict Representation (fact-level) | **Missing** — duplicate fact rows are schema-legal, resolved silently by `ORDER BY recorded_at DESC` | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Goals | Real rows, single-select per row (not multi-select array), `category` enum + optional `transition_id` | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Priority | `goals.priority` INT column exists, read by zero application code | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Timing | `goals.target_date` DATE column exists, read by zero application code | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Dependencies | Only `goal_conflict_rules` (pairwise, human-authored, no inference); no general dependency graph | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Resources / Reservation | **Missing entirely** — no allocation/reservation concept anywhere | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Barriers | `constraints` table, 12-type CHECK, real detection in `intelligenceEngine.js` — solid | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Recommendations / Next Move | Single-goal, single-candidate (earliest unmet requirement by `sequence_order`); no cross-goal ranking, no reason-code taxonomy | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Reconciliation | No unified engine; three separate on-demand fingerprint/evidence-dedup writers (weather/leverage/recommendation), each idempotent and correctly guaranteed; nothing runs on a schedule | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Events / History | Per-domain append-only logs only (`state_snapshots`, `recommendations`); no unified event log | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| What Changed | Not implemented as a backend concept | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Domino | Not implemented as a backend concept in this repo (a client-side cascade *demo* exists per earlier task history — illustrative UI only, not backend reasoning) | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Opportunities | `capabilityGraph.js` — live provider counts, honestly quiet at zero, no fabrication | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Capabilities / Access | AND-chain authorization pattern (`capability_relevance_rules`), currently empty in practice (0 real providers, by design) | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Scenarios | `scenarioModel.js` — confirmed fully isolated from real state (only 2 write statements in the whole file, neither touches real tables); staleness-checked on read | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Documents | **Missing entirely** — no table, no upload endpoint, no storage, no OCR/extraction, confirmed by exhaustive repo-wide search | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Credit | No credit-specific data model beyond generic `current_state_facts`; `fact_type` has no `document_provided` value yet | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Sessions | Only Stripe checkout/billing-portal sessions; no consulting/coaching session data model | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Provider Registry | `network_providers` schema real and tested, 0 rows seeded on purpose (real business data, can't fabricate) | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| AI | One call site (`lib/scoring.js`, admissions scoring) — advisory-only, schema-validated output, human sends the actual decision, system prompt server-only | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Notifications | One job (`send-membership-reminders.js`), not actually cron-wired (`vercel.json` is `{}`), reads no intelligence state | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Orbit / Projection | Public homepage prototype (`prototype-chew-orbit.html`) — explicitly scripted/illustrative, not fed by any backend reasoning; correct as-is for a public demo | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Authorization | **None** on any intelligence API route — gated only by feature-flag status (`internal`/`preview`/etc.), not caller identity | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Auditability | Partial — append-only tables function as history for their own domain; no unified audit log; `api/admin-applications.js` has no access log | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Idempotency | Strong where implemented — 3 independently correct dedup mechanisms (fingerprint or evidence-equality + DB unique index) | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## Security items to carry forward (tracked, not solved here)

- `api/admin-applications.js` returns full applicant PII + AI scoring fields behind a single shared-secret query parameter, no scoping, no access log, no rate limit.
- No rate limiting exists on any endpoint in this repo.

These are Joinchew-specific and don't depend on the portal comparison — track them as their own remediation item, not blocked on this checklist.

## Explicit non-goals of this document

- Not a recommendation of what to build.
- Not a schema design.
- Not a migration plan (Section L of the deliverable below covers that, once the comparison is run).
- Not permission to build any of the "MISSING in Joinchew" rows inside Joinchew.

## What "when access returns" produces (not yet run)

Once `chew-portal` is readable, the first action is comparison, not code — deliver:

A. Joinchew strengths — B. chew-portal strengths — C. overlapping capabilities — D. conflicting semantics — E. duplicated logic — F. authoritative data ownership — G. authoritative reasoning ownership — H. website-only capabilities — I. portal-only capabilities — J. what becomes shared server-side architecture — K. what must never be shared client-side — L. migration/consolidation plan — M. first true cross-CHEW intelligence vertical slice.

Compare first. Decide authority second. Consolidate third. Build fourth.
