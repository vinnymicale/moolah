# Household Finance

A shared personal-finance & net-worth tracker for two people (you and your partner).
Log income and expenses on a **monthly calendar** with a running **projected cash balance**
(à la Dollarbird), categorize spending, mark transactions **recurring**, track **net worth**
across every account (checking, savings, credit cards, retirement, vehicle, property, loans…),
and see **trends** over time. Both of you sign in with Google and share one unified dataset.

Built with **Next.js 16 (App Router) · TypeScript · Prisma 7 · PostgreSQL · Auth.js v5 · Tailwind v4 · Recharts**.

---

## Features

- **Monthly calendar** — each day shows its income/expense events and a projected end-of-day
  cash balance that accounts for upcoming/expected and recurring transactions. Low-balance warnings.
- **Recurring transactions** — paychecks, rent, subscriptions; projected onto future days and
  "marked paid" when they actually happen.
- **Accounts & net worth** — assets vs. liabilities with a live net-worth total; manual balance
  snapshots build net-worth history (great for retirement accounts, car value, home value).
- **Categories** — colorful, icon-tagged income & expense categories (sensible defaults seeded).
- **Trends** — net worth over time, income vs. expenses, spending by category, budget vs. actual.
- **Dashboard** — net worth, monthly income/spend, savings rate, upcoming bills, recent activity.
- **Shared household** — invite your partner with a code; everything shows on one calendar with
  "who entered it" attribution.
- **Extras** — CSV export, dark mode, mobile-friendly, an email allow-list, and unit-tested
  recurrence/projection math.

---

## Quick start (local, zero cloud setup)

You need **Node 20+**. No Docker or system Postgres required — a real Postgres is downloaded and
run for you by [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres).

```bash
npm install
cp .env.example .env          # the defaults already work for local dev

# Terminal 1 — start the bundled local Postgres (leave running)
npm run db:local

# Terminal 2 — create the schema + demo data, then run the app
npm run db:migrate            # applies migrations
npm run db:seed               # loads a demo household you can log into
npm run dev
```

Open <http://localhost:3000>. Because `AUTH_DEV_LOGIN="true"` in your local `.env`, the sign-in
screen shows a **Dev Login** — enter `demo@example.com` to open the seeded household. (Google is
not required for local development.)

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the app |
| `npm run db:local` | Run the bundled local Postgres on port 5433 |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Load/refresh the demo household |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run test` | Run the unit tests (recurrence & projection math) |
| `npm run build` | Production build |

---

## Setting up Google sign-in

Local dev works without this, but you'll want real Google login for day-to-day use.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create (or pick) a project.
2. **APIs & Services → OAuth consent screen** → choose **External**, fill in the app name and your
   email, and add yourself + your partner as **Test users** (or publish the app).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → **Web application**.
4. Add **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google` (local)
   - `https://YOUR-DOMAIN.vercel.app/api/auth/callback/google` (production)
5. Copy the **Client ID** and **Client secret** into `.env`:
   ```env
   AUTH_GOOGLE_ID="...apps.googleusercontent.com"
   AUTH_GOOGLE_SECRET="..."
   AUTH_DEV_LOGIN="false"     # turn the dev bypass off once Google works
   ```
6. (Recommended) Restrict who can sign in:
   ```env
   ALLOWED_EMAILS="you@gmail.com,partner@gmail.com"
   ```

The first person to sign in creates the household; the second joins with the **invite code** shown
on the **Settings** page.

---

## Deploying to Vercel + Postgres

1. **Database** — create a free Postgres (e.g. [Neon](https://neon.tech) or Vercel Postgres) and
   copy its connection string.
2. **Push** this repo to GitHub and **import** it into [Vercel](https://vercel.com).
3. **Environment variables** in the Vercel project settings:
   ```env
   DATABASE_URL=postgresql://...        # your hosted Postgres (with sslmode=require)
   AUTH_SECRET=...                      # run: npx auth secret
   AUTH_GOOGLE_ID=...
   AUTH_GOOGLE_SECRET=...
   ALLOWED_EMAILS=you@gmail.com,partner@gmail.com
   NEXTAUTH_URL=https://YOUR-DOMAIN.vercel.app
   ```
4. **Run migrations** against the hosted DB once (from your machine, with `DATABASE_URL` pointed at
   it): `npx prisma migrate deploy`. Optionally `npm run db:seed` if you want demo data.
5. Add the production redirect URI to your Google OAuth client (step 4 above) and deploy.

`npm run build` runs `prisma generate` automatically, so Vercel builds work out of the box.

---

## How the cash projection works

Each cash account (checking/savings/cash flagged "include in cash flow") has a `currentBalance`
that's treated as the truth **as of today**. For any calendar day the projected end-of-day balance
is `todayBalance + (cumulative signed transactions up to that day − cumulative up to today)`, where
income is `+` and expense is `−`. This single formula reconstructs past days and projects future
ones — including not-yet-cleared and recurring items. The logic lives in
[`src/lib/projection.ts`](src/lib/projection.ts) and [`src/lib/recurrence.ts`](src/lib/recurrence.ts)
and is covered by unit tests.

> Note: recording transactions does **not** auto-mutate an account's `currentBalance`. Update real
> balances via **Update balance** on the Accounts page (which also builds net-worth history). This
> keeps reconciled balances and the projected ledger cleanly separated.

---

## Project structure

```
prisma/            schema.prisma, migrations, seed.ts
scripts/           local-db.ts (embedded Postgres runner)
src/
  app/(auth)/      sign-in & household onboarding
  app/(app)/       dashboard, calendar, transactions, accounts, recurring, categories, trends, settings
  actions/         server actions (mutations)
  lib/             prisma, auth/session, money, dates, recurrence, projection, calendar, reports, queries
  components/      AppChrome, TransactionModal, Modal, charts, icons
```
