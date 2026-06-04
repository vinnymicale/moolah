# Moolah

A shared personal-finance, budgeting & net-worth tracker for two people (you and your partner).
Log income and expenses on a **monthly calendar** with a running **projected cash balance**
(à la Dollarbird), link your banks with **Plaid** for automatic transaction sync, budget by
category, set **savings goals**, plan your **debt payoff**, and watch your **net worth** and
**trends** evolve over time. Both of you sign in with Google and share one unified dataset.

Built with **Next.js 16 (App Router) · TypeScript · Prisma 7 · PostgreSQL · Auth.js v5 · Plaid · Tailwind v4 · Recharts**.

![Moolah dashboard](docs/screenshots/dashboard.png)

> The dashboard, showing net-worth milestones, the safe-to-transfer suggestion, spending alerts,
> top payees, budgets, and recent activity. _(Sample data for illustration.)_

---

## Features

### Money in & out
- **Monthly calendar** — each day shows its income/expense events and a projected end-of-day
  cash balance that accounts for upcoming/expected and recurring transactions, with low-balance
  warnings. Days with many events expand into a full day view.
- **Recurring transactions** — paychecks, rent, subscriptions; projected onto future days and
  "marked paid" when they actually happen. Plaid sync smart-matches real charges to recurring
  rules so projections don't double-count.
- **Plaid bank integration** — securely link checking, savings, and credit-card accounts; balances
  and posted transactions sync automatically and are auto-categorised using the bank's own
  category data (with a one-click "fix categories" re-run).
- **CSV import** — drag-and-drop a bank CSV anywhere to review and import transactions.

### Planning
- **Budgets** — set monthly limits per category and track spent-vs-remaining, on the dashboard
  and in trends.
- **Savings goals** — track progress toward targets (emergency fund, vacation, down payment) with
  contributions and target dates.
- **Debt payoff planner** — model **avalanche** (highest APR first) or **snowball** (smallest
  balance first) strategies, add an extra monthly payment, and see your debt-free date, total
  interest, interest saved vs. minimums, a balance-over-time chart, and per-debt payoff order.
- **Safe-to-transfer suggestion** — the dashboard estimates how much you can safely move out of
  checking this month after remaining bills and a history-based buffer for next month's typical
  early-month spending.

### Accounts & insight
- **Accounts & net worth** — assets vs. liabilities with a live net-worth total; manual balance
  snapshots build net-worth history (great for retirement, vehicle, or property values). Any
  account can be **excluded from net worth** while still being tracked (e.g. student loans).
- **Trends** — net worth over time, income vs. expenses, spending by category, budget vs. actual,
  and a category month-over-month comparison table.
- **Dashboard** — net worth, monthly income/spend, savings rate, upcoming bills, recent activity,
  spending alerts (categories trending over their 3-month average), top payees, and net-worth
  milestone celebrations. Cards are drag-to-reorder.

### Finding & exporting
- **Global search (⌘K)** — a command palette to search your entire transaction history by name,
  note, or amount from anywhere, with keyboard navigation.
- **Powerful filtering** — multi-select filters (type, status, categories, accounts), custom date
  ranges, and named **saved filters** on the Transactions page.
- **Data export** — download your full transaction history as CSV, filtered by date, account, or
  category, from Settings.

### Shared & polished
- **Shared household** — invite your partner with a code; everything shows on one calendar with
  "who entered it" attribution.
- **Extras** — dark mode, mobile-friendly, keyboard shortcuts, an email allow-list, and
  unit-tested recurrence / projection / debt-payoff math.

---

## Screenshots

A tour of every page. _(Sample data — generated from the isolated `demo@example.com` household.)_

### Money in & out

**Monthly calendar** — each day shows its income/expense events and a projected end-of-day cash balance.
![Calendar](docs/screenshots/calendar.png)

**Transactions** — search, multi-select filters (type, status, category, account), date ranges, and CSV export.
![Transactions](docs/screenshots/transactions.png)

**Recurring** — paychecks, bills, and subscriptions that repeat automatically on the calendar.
![Recurring](docs/screenshots/recurring.png)

### Planning

**Budgets** — set a monthly limit per category and track spent-vs-remaining, with copy-from-last-month.
![Budgets](docs/screenshots/budgets.png)

**Savings goals** — track progress toward targets (emergency fund, vacation, down payment) with contributions and target dates.
![Savings goals](docs/screenshots/goals.png)

**Debt payoff** — model **avalanche** or **snowball**, add an extra payment, and see your debt-free date, total interest, a balance-over-time chart, and per-debt payoff order.
![Debt payoff](docs/screenshots/debt.png)

### Accounts & insight

**Accounts & net worth** — assets vs. liabilities with a live net-worth total and per-account balance history.
![Accounts & net worth](docs/screenshots/accounts.png)

**Trends** — net worth over time, income vs. expenses, spending by category, budget vs. actual, and month-over-month comparison.
![Trends](docs/screenshots/trends.png)

### Dark mode

A built-in **dark theme** (toggle in the sidebar) carries across every page.
![Dashboard in dark mode](docs/screenshots/dashboard-dark.png)

### Setup & organization

**Categories** — organize how you classify income and spending, each with its own icon and color.
![Categories](docs/screenshots/categories.png)

**Settings** — rename your household, share the invite code, export data as CSV, and manage members.
![Settings](docs/screenshots/settings.png)

**Sign in & onboarding** — Google sign-in (with a local dev login), then create or join a shared household.

| Sign in | Set up your household |
| --- | --- |
| ![Sign in](docs/screenshots/signin.png) | ![Welcome](docs/screenshots/welcome.png) |

---

## Quick start (local, zero cloud setup)

You need **Node 20+**. No Docker or system Postgres required — a real Postgres is downloaded and
run for you by [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres).

```bash
npm install
cp .env.example .env          # the defaults already work for local dev

# Create the schema + demo data (one-time; starts the bundled DB as needed)
npm run db:local &            # bundled local Postgres on port 5433 (or use start:all below)
npm run db:push               # sync the schema to the database
npm run db:seed               # load a demo household you can log into

# Run the database and web app together
npm run start:all
```

`npm run start:all` runs the bundled Postgres **and** the Next.js dev server side by side (via
`concurrently`), so you only need one terminal. Open <http://localhost:3000>.

Because `AUTH_DEV_LOGIN="true"` in your local `.env`, the sign-in screen shows a **Dev Login** —
enter `demo@example.com` to open the seeded household. (Google is not required for local
development.)

> **Heads up:** the web app needs the database running. Use `npm run start:all` (DB + web) rather
> than `npm run dev` alone, or the app will fail to reach Postgres.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run start:all` | Run the bundled Postgres **and** the app together |
| `npm run dev` | Start just the app (assumes the DB is already running) |
| `npm run db:local` | Run the bundled local Postgres on port 5433 |
| `npm run db:push` | Sync the Prisma schema to the database |
| `npm run db:seed` | Load/refresh the isolated demo household |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run test` | Run the unit tests (recurrence, projection & debt-payoff math) |
| `npm run build` | Production build |

The demo seed is fully isolated: it only ever touches a throwaway `demo@example.com` household and
never modifies a real user's data.

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

## Connecting banks with Plaid (optional)

To enable automatic bank sync, add Plaid credentials to `.env`:

```env
PLAID_CLIENT_ID="..."
PLAID_SECRET="..."
PLAID_ENV="sandbox"        # sandbox | development | production
```

Get these from the [Plaid Dashboard](https://dashboard.plaid.com/). With `sandbox` you can link
test institutions without real bank data. Once set, use **Connect a bank** on the Accounts page;
balances and posted transactions sync automatically and are auto-categorised from the bank's
category data. Linking is optional — manual and CSV entry work without Plaid.

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
   # Optional, for bank sync:
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...
   PLAID_ENV=production
   ```
4. **Sync the schema** against the hosted DB once (from your machine, with `DATABASE_URL` pointed
   at it): `npx prisma db push`. Optionally `npm run db:seed` if you want demo data.
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
> balances via **Update balance** on the Accounts page (which also builds net-worth history), or
> let Plaid sync keep linked balances current. This keeps reconciled balances and the projected
> ledger cleanly separated.

---

## Project structure

```
prisma/            schema.prisma, migrations, seed.ts
scripts/           local-db.ts (embedded Postgres runner)
src/
  app/(auth)/      sign-in & household onboarding
  app/(app)/       dashboard, calendar, transactions, accounts, recurring,
                   budgets, goals, debt, categories, trends, settings
  app/api/         plaid (link/exchange/sync/recategorize), export (CSV)
  actions/         server actions (mutations)
  lib/             prisma, auth/session, money, dates, recurrence, projection,
                   calendar, reports, queries, plaid-sync, debt-payoff, milestones
  components/      AppChrome, CommandPalette, MultiSelect, TransactionModal,
                   Modal, charts, icons
```
