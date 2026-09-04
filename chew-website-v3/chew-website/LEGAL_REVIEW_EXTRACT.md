# Legal Counsel Review Extract — Monthly Plan / Payment Provisions

**LEGAL COUNSEL REVIEW RECOMMENDED.** This is not a legal opinion and does
not constitute attorney approval of any provision below. It is a targeted
extract of the specific contract language that is NEW as of the Monthly
Plan / 5-tier engagement architecture (`preview/contract-agreement-
intelligence`), assembled so a Florida business/consumer-contract attorney
can review exactly what changed without re-reading the entire Client
Services Agreement. No substantive commercial or legal term has been
silently altered to produce this extract — every quote below is verbatim
from `lib/agreementText.js`, rendered for the Infrastructure tier as a
representative example (the same structure and clause language applies,
with different dollar amounts, to Focused Builder, Advanced Infrastructure,
and Executive Advisory — see the exactness verification in the accompanying
commit history for the four tiers' amounts).

---

## 1. Document Review Event definition / ceiling — Section 3.6 (new)

> **3.6 Document Review Events.** A document review event, as referenced in
> Section 1, covers up to 15 pages or 5 documents submitted together for one
> related purpose (for example: one tax return, one month of bank
> statements, or one business formation document set). A larger or
> unrelated submission may be split across multiple review events, or may
> fall outside your engagement's scope and require a new engagement under
> Section 4.7 below.

**Why this needs review:** "Document review event" is referenced as a
countable, scope-limiting unit throughout Section 1 (e.g., "2 defined
document review events") but had no operative definition anywhere in the
prior agreement. The 15-page / 5-document ceiling proposed here is a
business-side estimate of a "fair practical ceiling," not a legally
reviewed number. Flag specifically: is the ceiling itself reasonable and
enforceable as a scope limiter; is "one related purpose" precise enough to
avoid disputes; does splitting an oversized submission across multiple
review events need clearer client-facing process language.

---

## 2. Monthly Plan authorization — Section 3.2 (new)

> **3.2 Payment Options.** The total price for your selected engagement is
> **$1,997**, quoted and confirmed at checkout. You choose one of two
> payment options — both total the identical price; the option you choose
> changes only the timing of payment, never the scope, quality, or total
> cost of your engagement:
> - **Pay in Full** — one payment of $1,997 today.
> - **Monthly Plan** — $497 today, then 3 monthly payments of $500, billed
>   automatically to the payment method on file.
>
> Your selected option, and the exact amounts and schedule above, are
> recorded with your signature below and confirmed again on your Deal Sheet
> before you pay.

**Why this needs review — flagging a real gap, not just the obvious one:**
this section describes that installments will be "billed automatically to
the payment method on file," but nowhere in the agreement (including
Section 10's Electronic Signature clause, quoted in §7 below) is there
explicit, standalone authorization language of the kind typically expected
for recurring/automatic future debits — e.g., "You authorize CHEW to charge
the payment method on file for each scheduled installment according to this
schedule, without further authorization for each individual charge." The
current text states what will happen as a fact of the payment plan's
mechanics; it does not use clear consent/authorization phrasing specific to
recurring charges, which is commonly treated as a distinct requirement from
signing the agreement itself. Recommend counsel confirm whether this needs
its own explicit authorization clause (and whether it should also state how
a client can revoke that authorization, e.g., by paying off the balance or
requesting a payment-method change).

---

## 3. Failed-payment process / retry / grace period / service-pause rights — Section 3.5 (new)

> **3.5 Late or Failed Monthly Plan Payments.** If a scheduled Monthly Plan
> installment fails, CHEW's payment processor will automatically retry the
> charge. If you're on the Monthly Plan, you'll be notified immediately of
> any failed payment. If the payment remains unresolved after a reasonable
> grace period, CHEW may pause further session delivery and Client Portal
> access until the balance is cured, and will notify you before doing so.
> CHEW will not delete your signed Agreement, delete work already
> completed, or charge you twice for the same installment. Continued
> non-payment beyond 15 days of notice is grounds for termination under
> Section 5.

**Why this needs review:** "a reasonable grace period" is not a defined
number of days anywhere in this clause, while the very next sentence
references a specific "15 days of notice" as the termination trigger —
counsel should confirm whether the undefined "reasonable grace period" is
intended to mean the same 15-day window, a shorter window before it, or is
genuinely meant to be flexible; as written it is ambiguous. Also confirm:
whether "pause further session delivery and Client Portal access" is
sufficiently specific about what a client loses access to; whether the
notice requirement ("will notify you before doing so") needs a defined
delivery method (email, portal notice) or minimum advance notice period.

**Implementation note for counsel's awareness (not a legal question, a
factual one):** the underlying Stripe billing implementation retries a
failed installment against the same invoice automatically per Stripe's own
retry schedule, and CHEW's system distinguishes a successful late cure from
a genuine failure without regressing already-paid installments (see the
webhook hardening commit). No interest or late fee is charged — the
retried/cured amount is always the original installment amount.

---

## 4. Remaining-balance obligation — Sections 3.4, 4.6, 5

> **3.4 Refunds** (excerpt): "...Once a strategy session has been delivered
> or a Financial Blueprint has been provided, all amounts paid become
> non-refundable, **and any remaining Monthly Plan installments remain due
> for services already in progress**, except where required by applicable
> law."

> **4.6 Forfeiture of Program Access** (excerpt): "...amounts already paid
> are not refunded, and **any remaining Monthly Plan installments already
> invoiced remain due** under the original payment schedule."

> **Section 5, Term, Cancellation, and Termination** (excerpt): "Cancelling
> does not relieve you of Monthly Plan installments already invoiced for
> services already delivered."

**Why this needs review:** these three clauses each state the remaining-
balance obligation slightly differently — 3.4 says "any remaining Monthly
Plan installments remain due," 4.6 and Section 5 both narrow it to
"installments already invoiced." Counsel should confirm these are intended
to be the same rule stated three ways (in which case the 3.4 language
should probably be tightened to match "already invoiced," since a Monthly
Plan client's *not-yet-invoiced future installments should likely NOT come
due all at once on cancellation, only the ones scheduled/invoiced for work
already delivered) or whether a genuine substantive difference is intended
between the refund, forfeiture, and termination scenarios.

---

## 5. Cancellation interaction — Section 5

> **Section 5, Term, Cancellation, and Termination** (excerpt, tier-specific
> line): "**Infrastructure Program** — You may cancel at any time by
> written notice. Refunds, if any, are governed by the refund terms above.
> Cancelling does not relieve you of Monthly Plan installments already
> invoiced for services already delivered."

**Why this needs review:** confirm the cross-reference to "the refund terms
above" (3.4) is unambiguous given 3.4's own wording nuance flagged in §4
above; confirm "at any time by written notice" doesn't need a defined
notice period or delivery method to be enforceable/administrable.

---

## 6. Refund interaction — Section 3.4

> **3.4 Refunds.** Your initial payment (the full price under Pay in Full,
> or the first payment under the Monthly Plan) is refundable in full if you
> request cancellation in writing within 3 business days of payment,
> provided you have not yet attended a strategy session or received your
> Financial Blueprint. Once a strategy session has been delivered or a
> Financial Blueprint has been provided, all amounts paid become
> non-refundable, and any remaining Monthly Plan installments remain due
> for services already in progress, except where required by applicable
> law.

**Why this needs review:** this clause pre-dates the Monthly Plan
architecture in substance (a 3-day refund window tied to first
session/Blueprint delivery) but was extended verbatim to cover "the first
payment under the Monthly Plan" — confirm this extension is legally sound
as-is, and see §4 above for the "remaining installments" wording
inconsistency across clauses.

---

## 7. Electronic / recurring-payment authorization — Section 10

> **Electronic Signature.** By checking the box below and typing your full
> legal name, you consent to sign this Agreement electronically, as
> permitted under Florida's Uniform Electronic Transaction Act (Fla. Stat.
> § 668.50). This electronic signature has the same legal effect as a
> handwritten signature. CHEW retains your typed name, the affirmative
> checkbox confirmation, the timestamp, an identifier of the exact
> agreement version and text you were shown, and technical metadata (such
> as IP address) as evidence of your consent.

**Why this needs review:** this clause authorizes the ELECTRONIC SIGNATURE
of the agreement itself under Florida's UETA. It does not separately
authorize recurring/automatic future payment debits for the Monthly Plan —
see the gap flagged in §2 above. Counsel should confirm whether Florida law
or card-network rules require a distinct recurring-payment authorization
clause beyond what's in 3.2, and if so, what language satisfies it.

**Engineering note on what is actually retained (not a legal conclusion):**
the paragraph above describes what the agreement text *asserts* CHEW
retains. What the system actually persists, per client signature, is: an
immutable snapshot of the exact agreement HTML shown at signing, the
agreement version identifier, a content hash of that snapshot, the signed
timestamp, and a durable copy delivered to both the client and CHEW at
signing time. CHEW retains a durable, reproducible evidence record of the
signed agreement. This is a description of the technical record, not a
claim about its legal weight or sufficiency in any dispute — that
determination is for counsel, not engineering, to make.

---

## Summary of items flagged for counsel

1. Undefined "reasonable grace period" vs. the specific "15 days of notice" in 3.5 — clarify or reconcile.
2. No explicit recurring/automatic-payment authorization clause distinct from e-signature consent (3.2 / Section 10 gap).
3. Inconsistent wording of the remaining-balance obligation across 3.4, 4.6, and Section 5 ("remaining" vs. "already invoiced").
4. The 15-page / 5-document Document Review Event ceiling (3.6) is a business estimate, not yet legally reviewed.
5. No defined notice period/method for cancellation ("at any time by written notice," Section 5) or for the pre-pause notice in 3.5.

**LEGAL COUNSEL REVIEW RECOMMENDED before this contract language is used to
bind a real, paying client.** Nothing above has been changed unilaterally —
these are the exact provisions as currently drafted, flagged for review,
not yet altered.
