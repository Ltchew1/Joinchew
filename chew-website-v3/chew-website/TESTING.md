# Testing the CHEW Booking Backend — Step by Step

Do these in order. Each step confirms one piece works before you rely on it.
Use Stripe **test mode** the whole way through — don't touch live keys until
the very last step.

---

## 0. Before you start

Confirm all of these are set in Vercel → Settings → Environment Variables:
`STRIPE_SECRET_KEY` (test key, starts `sk_test_`), `STRIPE_PRICE_STRATEGY`,
`STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_EXECUTIVE`, `STRIPE_WEBHOOK_SECRET`,
`DATABASE_URL`, `RESEND_API_KEY`, `FROM_EMAIL`, `SITE_URL`, `CRON_MANUAL_SECRET`.

Redeploy after adding/changing any of these — Vercel doesn't pick up changes
until the next deploy.

---

## 1. Confirm the database is reachable

In your Postgres provider's SQL editor (Vercel Postgres or Supabase), run:
```sql
SELECT * FROM bookings LIMIT 1;
```
If this errors with "relation does not exist," you haven't run `db/schema.sql`
yet — do that first.

---

## 2. Confirm available slots load

Visit `https://your-site.vercel.app/api/available-slots` directly in your browser.

**Expect:** a JSON response like `{"slots":[{"iso":"...","label":"Mon, Jul 13, 9:00 AM EDT"}, ...]}`

**If you get an error instead:** check the Vercel function logs (Vercel dashboard →
your project → Deployments → click the latest → Functions tab) — it'll show the
exact error, almost always a missing/wrong `DATABASE_URL`.

---

## 3. Book a real (test) session end-to-end

1. Go to `/book-consultation.html` on your live site.
2. Confirm real time slots appear (not "Loading..." forever, not an error).
3. Pick a slot, fill in your own name/email, submit.
4. You should land on Stripe's real checkout page.
5. Use the test card **4242 4242 4242 4242**, any future expiry date, any 3-digit CVC,
   any billing zip.
6. Complete payment — you should land on `/booking-confirmed.html`.

**If checkout never loads:** check Vercel function logs for `create-checkout-session` —
usually a wrong Price ID or missing `STRIPE_SECRET_KEY`.

---

## 4. Confirm the webhook actually fired

Right after step 3, check your database:
```sql
SELECT id, tier, client_email, status, slot_start, confirmed_at FROM bookings
ORDER BY id DESC LIMIT 1;
```
**Expect:** `status = 'confirmed'` and `confirmed_at` has a real timestamp.

**If status is still `pending`:** the webhook didn't fire. Check:
- Stripe Dashboard → Developers → Webhooks → your endpoint → look for failed
  delivery attempts and the error message they show.
- Most common cause: `STRIPE_WEBHOOK_SECRET` in Vercel doesn't match what
  Stripe Dashboard shows for that endpoint.

---

## 5. Confirm the confirmation email arrived

Check the inbox you used in step 3. Should arrive within a few seconds of payment.

**If it didn't arrive:** check Resend's dashboard (resend.com → Logs) — it shows
every send attempt and why one failed (usually an unverified sending domain).

---

## 6. Test the reminder job manually (don't wait for the real cron)

Visit (in your browser, or via curl):
```
https://your-site.vercel.app/api/send-reminders?manual=YOUR_CRON_MANUAL_SECRET
```
(replace with the actual value you set for `CRON_MANUAL_SECRET`)

**Expect:** `{"checked": N, "sent": N}`. If you just booked a session more than
24 hours out, `sent` will correctly be 0 — that's right, not a bug. To actually
test a reminder firing, book a test session for a slot within the next 24 hours
first (temporarily edit `lib/availability.js` if today's slots are already gone),
then run this again.

---

## 7. Try to double-book a slot on purpose

Open two browser tabs, both on `/book-consultation.html`, both select the *same*
slot, both submit within a few seconds of each other. One should succeed, the
other should get "That time slot was just taken" — this confirms the database's
unique constraint is actually preventing double-booking, not just the UI hiding it.

---

## 8. Only after all of the above pass: go live

1. Stripe Dashboard → switch from test mode to live mode.
2. Create your three real Products/Prices again in live mode (test-mode prices
   don't carry over).
3. Update `STRIPE_SECRET_KEY`, the three `STRIPE_PRICE_*` variables, and
   `STRIPE_WEBHOOK_SECRET` in Vercel to their live-mode equivalents.
4. Redeploy, then do ONE real small test booking yourself with a real card to
   confirm live mode works before telling anyone else the site is open for business.
