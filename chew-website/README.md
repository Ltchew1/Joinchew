 # CHEW Website

A complete website and booking backend for CHEW LLC — 13 pages, real scheduling,
Stripe payment, and automated email, built to deploy on Vercel.

## What's included

**Pages (13):** Home, About, Services, How It Works, Pricing, Resources, FAQ, Contact,
Book a Consultation, Booking Confirmed, Privacy Policy, Terms of Use, Disclaimer.

**Backend:**
- `/api/available-slots.js` — returns open booking times
- `/api/create-checkout-session.js` — creates a Stripe Checkout session, holds the
  selected time slot in the database so two people can't book the same time
- `/api/stripe-webhook.js` — confirms payment server-side, sends confirmation email
- `/api/send-reminders.js` — reminder emails (currently manual-trigger only — see note below)
- `lib/db.js`, `lib/availability.js`, `lib/email.js` — shared helpers
- `db/schema.sql` — the one table (`bookings`) this all runs on

See `CHEW_MASTER_CONTEXT.md` for the full architecture, brand details, decision
history, and roadmap — read that before making changes.

## Before you publish

1. **Email address** — every page points to `leroyt@joinchew.com`. Confirm that
   inbox is active.

2. **Contact form still isn't connected** — it shows an honest "not connected yet"
   message (see `script.js`). Connect it to a real service (Formspree or similar)
   or submissions vanish. (The *booking* form is fully wired — see below.)

3. **Full booking backend — here's exactly how to activate it:**

   **Deploy to Vercel** (required — Netlify Drop and GitHub Pages can't run the
   serverless functions this needs).

   **A. Database (5 min, free to start)**
   - Vercel Postgres (Vercel dashboard → Storage → Create Database) or supabase.com.
   - Run `db/schema.sql` against it once via their SQL editor.
   - Copy the connection string.

   **B. Stripe (10 min)**
   - Create three Products/Prices: CHEW Strategy Session ($97), CHEW Growth Strategy
     Session ($197), CHEW Executive Strategy Session ($297). Copy each Price ID.
   - Developers → Webhooks → Add endpoint → `https://www.joinchew.com/api/stripe-webhook`
     → event `checkout.session.completed`. Copy the signing secret.

   **C. Email (5 min, free to start)**
   - Sign up at resend.com, verify your sending domain, copy your API key.

   **D. Vercel environment variables**
   - Add every variable from `.env.example` with real values, in Vercel's dashboard
     only — never in a file you upload or commit.
   - Redeploy.

   **E. Test before going live**
   - Book a real slot with a Stripe test card (4242 4242 4242 4242, any future date/CVC).
   - Confirm the confirmation email arrives, then switch Stripe to live mode.

4. **Legal review flag** — Privacy Policy, Terms of Use, and Disclaimer all say, on
   the page, that they haven't had legal review yet. Given CHEW operates in financial
   services, get that done before launch — the Disclaimer page especially carries real
   regulatory weight if worded incorrectly.

5. **Reminder emails are manual-trigger only, for now.** `vercel.json` was simplified
   to `{}` after an "Invalid vercel.json" error during initial deploy (Vercel's free
   Hobby plan only allows daily, not hourly, automatic cron jobs). Everything else
   works fully automatically (payment, booking, confirmation email) — only the
   24-hour reminder needs a manual visit to
   `/api/send-reminders?manual=<CRON_MANUAL_SECRET>` until this is revisited.

## How to publish

1. Download and extract this folder.
2. Create a GitHub repo, upload everything (including `api/`, `lib/`, `db/`).
3. Sign up at vercel.com → Continue with GitHub → Import your repo → Deploy.
4. Complete the environment variable setup above, then redeploy.

## What's next

Client portal, admin dashboard, mobile app, and AI assistant are the remaining phases —
see `CHEW_MASTER_CONTEXT.md` Section 10 for what each depends on and why they're
sequenced in that order.
