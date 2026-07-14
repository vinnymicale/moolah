# Moolah

A self-hosted personal-finance, budgeting & net-worth tracker.
Log income and expenses on a **monthly calendar** with a running **projected cash balance**, link your banks with **Plaid** for automatic transaction sync, budget by
category, set **savings goals**, plan your **debt payoff**, and watch your **net worth** and
**trends** evolve over time. Your data lives in your own database, on your own machine.

Built with **Next.js 16 (App Router) · TypeScript · Prisma 7 · PostgreSQL · Auth.js v5 · Plaid · Tailwind v4 · Recharts**.

[![CI](https://github.com/vinnymicale/moolah/actions/workflows/ci.yml/badge.svg)](https://github.com/vinnymicale/moolah/actions/workflows/ci.yml)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-FFDD00?style=flat&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/vinnymicale)

**[Try the live demo →](https://moolah-five.vercel.app)** - no sign-up; it serves a seeded sample
dataset, and anything you change stays in your browser only.

> **AI disclaimer:** Moolah was built with help from AI (Anthropic's Claude). Treat it
> accordingly - review the code yourself before trusting it with sensitive financial data, and note
> that it comes with no warranty (see [Disclaimer](#disclaimer)).

![Moolah dashboard](docs/screenshots/dashboard.png)

> The dashboard, showing net-worth milestones, the safe-to-transfer suggestion, spending alerts,
> top payees, budgets, and recent activity. _(Sample data for illustration.)_

---

## Roadmap

Planned improvements, roughly in priority order:

- **Household / multi-user support** *(in progress)* - share one dataset with a partner: invite
  codes, per-member attribution on transactions, and a shared calendar. Local name+password
  accounts with per-user data and Plaid keys already landed; the shared-household layer is next.
- **Transaction tags** - free-form labels (e.g. "vacation 2026", "reimbursable", "tax-deductible")
  that cut across categories, with tag-based filtering/totals in search and rule-based auto-tagging.

### Recently shipped

- **UI redesign** - grouped Track / Plan / Insights nav with drag-reorder, a mobile bottom tab
  bar, a display typeface for headings, tabular-mono currency, and subtle entrance motion.
- **Notifications** - rule-based triggers with an in-app inbox and optional Discord delivery.
- **Budget suggestions** - a modal that proposes limits from your recurring charges and typical
  variable spending. Plus **budget rollover** for carrying unspent amounts forward.
- **Transaction trash & duplicate finder** - soft-delete with restore, and a scanner that finds
  and cleans up duplicated imports.
- **Command bar** - ⌘K for jump-to-page navigation, global transaction search, and quick actions.
- **PWA install** - add Moolah to your phone's home screen.
- **Rules & automation center** - define rules (description contains, amount range, account,
  type) that auto-categorize, mark transfers, split by ratio, or clean up messy payee names, with
  a dry-run preview and a "run on existing transactions" backfill.
- **Net Worth page** - automatic daily snapshots, a history chart, and a 12-month forecast.
- **Category splits** - divide one transaction across multiple categories.
- [Docker support](#self-hosting-with-docker), the [read-only data API](#read-only-data-api), and
  [in-app backup restore](#backing-up-your-data-and-your-plaid-connections).

Have a request? Open an issue on GitHub.

---

## Features

### Money in & out
- **Monthly calendar** - each day shows its income/expense events and a projected end-of-day
  cash balance that accounts for upcoming/expected and recurring transactions, with low-balance
  warnings. Days with many events expand into a full day view.
- **Recurring transactions** - paychecks, rent, subscriptions; projected onto future days and
  "marked paid" when they actually happen. Plaid sync smart-matches real charges to recurring
  rules so projections don't double-count.
- **Plaid bank integration** - securely link checking, savings, and credit-card accounts; balances
  and posted transactions sync automatically and are auto-categorised using the bank's own
  category data (with a one-click "fix categories" re-run). If a bank connection breaks, a
  **Reconnect** button re-authenticates it in place - same Plaid item, so no new billed connection.
- **Rules & automation** - define rules from conditions (description contains, amount range,
  account, type, combined with AND) that auto-categorize, rewrite messy payee names, mark
  transfers, or split a charge by ratio. Rules run on every bank sync and CSV import (beating the
  generic mappers); a dry-run preview shows what would change before you commit, and a one-click
  backfill applies them across existing history (never overwriting a category you set by hand).
  Managed on the Categories page.
- **Transfer matching** - credit-card payments are detected automatically (the checking debit and
  the card credit are linked as a pair) and excluded from income/spending totals, so paying your
  card never counts as "spending" twice. Pairs can also be linked/unlinked by hand.
- **Split transactions** - attribute one charge to multiple categories (a Costco run that's part
  groceries, part household). Budgets, trends, and spending alerts count each split part under its
  own category, while the charge still totals once.
- **CSV import** - drag-and-drop a bank CSV anywhere to review and import transactions.
- **Trash & undo** - deletes are soft, not permanent. A trash drawer shows recently deleted
  transactions to restore or remove for good. A **duplicate finder** on the Accounts page groups
  identical copies (account, day, amount, type, description), keeps the oldest, and clears the rest -
  and a **Re-import all** button rebinds transactions by content after a Plaid cursor reset instead
  of duplicating them.

### Planning
- **Budgets** - set monthly limits per category and track spent-vs-remaining, on the dashboard
  and in trends. **Suggest budgets** proposes a starting set of limits from your detected recurring
  charges (yearly charges land at full amount in their renewal month, and charges that stopped
  recurring are flagged "possibly ended" and left out) plus a "typical variable spending" figure
  from the median of the last six months. Each line links to the transactions behind it, and your
  tweaks are remembered per month. **Rollover** carries a category's leftover forward into the next
  month, **copy previous month** clones last month's limits, and **clear month** wipes them all in
  two clicks.
- **Savings goals** - track progress toward targets (emergency fund, vacation, down payment) with
  contributions and target dates.
- **Debt payoff planner** - model **avalanche** (highest APR first) or **snowball** (smallest
  balance first) strategies, add an extra monthly payment, and see your debt-free date, total
  interest, interest saved vs. minimums, a balance-over-time chart, and per-debt payoff order.
- **Safe-to-transfer suggestion** - the dashboard estimates how much you can safely move out of
  checking this month after remaining bills and a history-based buffer for next month's typical
  early-month spending.

### Accounts & insight
- **Accounts & net worth** - assets vs. liabilities with a live net-worth total. Any account can
  be **excluded from net worth** while still being tracked (e.g. student loans).
- **Net Worth page** - a dedicated history chart of assets, liabilities, and net worth over time
  (3M / 1Y / All), with a year-to-date change callout. Balances are snapshotted automatically on
  every account sync and carried forward across gap days, so the line reflects real changes
  (including market moves), not just transaction activity. A dashed **12-month forecast** projects
  net worth forward from your recurring income and expenses, and a banner warns when the
  trajectory dips negative or drops sharply. Manual **Update balance** snapshots still feed the
  same history (great for retirement, vehicle, or property values).
- **Trends** - net worth over time, income vs. expenses, spending by category, budget vs. actual,
  and a category month-over-month comparison table.
- **Dashboard** - net worth, monthly income/spend, savings rate, upcoming bills, recent activity,
  spending alerts (categories trending over their 3-month average), top payees, and net-worth
  milestone celebrations. Cards are drag-to-reorder.
- **Notification center** - rule-based notifications (connection health, budgets, bills,
  transactions, scheduled digest) with an in-app inbox and optional Discord webhook delivery
  with custom message templates. Notifications live at **Notifications** in the sidebar (not
  Settings). Each rule pairs a trigger (bank connection needs relinking, budget exceeded, bill
  due, large transaction, scheduled digest, and more) with an optional Discord webhook channel
  and an optional custom message template using `{{variables}}`. Every fired rule lands in the
  in-app inbox; the sidebar bell shows an unread badge. Time-based triggers run on an in-process
  sweep every 15 minutes, so they need an always-on / self-hosted deployment (like scheduled
  backups). Transaction triggers fire immediately after a Plaid sync or CSV import.
- **AI assistant (optional)** - bring your own Anthropic, OpenAI, or Gemini API key (Settings) and
  chat with your finances: "how much did I spend on dining out last month?", "add a $15.99/month
  Netflix expense", "set a $500 grocery budget". The key is encrypted at rest and never sent to
  the browser.

### Finding & exporting
- **Command bar (⌘K)** - a command palette that searches your entire transaction history (by name,
  note, or amount) and doubles as a launcher: jump to any page or fire a quick action (new
  transaction, import CSV, open chat), all with keyboard navigation. Dashboard stat cards are
  drill-through links too - net worth, income/spent, and savings rate each open their detail page.
- **Powerful filtering** - multi-select filters (type, status, categories, accounts), custom date
  ranges, and named **saved filters** on the Transactions page.
- **Data export** - download your full transaction history as CSV, filtered by date, account, or
  category, from Settings.
- **Full backup & restore** - download a single JSON snapshot of everything (every table, including
  your Plaid access tokens) and restore it later - both from the CLI and directly in **Settings**.
  Restoring re-uses your existing Plaid connections, so moving to a new machine or Docker host
  costs no new billed bank links.
- **Scheduled backups** - on an always-on / self-hosted instance, run full backups automatically
  daily or weekly, keep a rolling number of copies (the oldest is pruned), and store them in a
  local folder (or mounted volume) or **Google Drive**. Configure it all from **Settings**, with a
  "Run backup now" button and last-run status.

### Polished
- **Extras** - dark mode, a mobile bottom-tab layout, **installable as a PWA** (web manifest and
  icons), keyboard shortcuts, an email allow-list, and dates that follow **your timezone** (not the
  server's). The interface uses a grouped sidebar (Track / Plan / Insights) you can drag to reorder,
  a display typeface for headings, tabular-mono digits for currency, and light entrance motion that
  respects "reduce motion". Recurrence / projection / debt-payoff / matching math is unit-tested,
  with a Playwright e2e suite and CI on every push and PR.

---

## Screenshots

A tour of the pages. _(Sample data - generated from the isolated `demo@example.com` account.)_

**Calendar**
![Calendar](docs/screenshots/calendar.png)

**Transactions**
![Transactions](docs/screenshots/transactions.png)

**Recurring**
![Recurring](docs/screenshots/recurring.png)

**Budgets**
![Budgets](docs/screenshots/budgets.png)

**Savings goals**
![Savings goals](docs/screenshots/goals.png)

**Debt payoff**
![Debt payoff](docs/screenshots/debt.png)

**Accounts & net worth**
![Accounts & net worth](docs/screenshots/accounts.png)

**Net Worth**
![Net Worth](docs/screenshots/networth.png)

**Trends**
![Trends](docs/screenshots/trends.png)

**Categories**
![Categories](docs/screenshots/categories.png)

**Settings**
![Settings](docs/screenshots/settings.png)

**Dark mode** carries across every page.
![Dashboard in dark mode](docs/screenshots/dashboard-dark.png)

---

## Quick start (local, zero cloud setup)

You need **Node 22+**. No Docker or system Postgres required - a real
Postgres is downloaded and run for you by
[`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres).

```bash
npm install
cp .env.example .env       # the defaults already work for local dev
npm run setup              # download the bundled DB (first run) & create the schema
npm run start:all          # run the database and web app together
```

`npm run start:all` runs the bundled Postgres **and** the Next.js dev server side by side (via
`concurrently`), so you only need one terminal. Open <http://localhost:3000>.

With the shipped defaults (`AUTH_BYPASS="true"`) you're **signed in automatically** as a local
user - no password or sign-in screen - so you can start adding transactions right away. Set
`AUTH_BYPASS="false"` when you want a real password-protected login.

> **Heads up:** the web app needs the database running. Use `npm run start:all` (DB + web) rather
> than `npm run dev` alone, or the app will fail to reach Postgres.

### Want to explore with sample data first?

Load an isolated demo dataset full of example accounts, transactions, budgets and goals:

```bash
npm run setup -- --seed    # create the schema *and* the demo data
```

Then, to browse that demo data, set `DEMO_MODE="true"` (with `AUTH_BYPASS="true"`) in `.env` and
relaunch - no sign-in needed. The demo seed is fully isolated: it only ever touches the throwaway
`demo@example.com` account and never modifies your own data.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run setup` | First-run: create the schema (add `-- --seed` for demo data) |
| `npm run start:all` | Run the bundled Postgres **and** the app together |
| `npm run dev` | Start just the app (assumes the DB is already running) |
| `npm run db:local` | Run the bundled local Postgres on port 5433 |
| `npm run db:push` | Sync the Prisma schema to the database |
| `npm run db:seed` | Load/refresh the isolated demo data |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run test` | Run the unit tests (recurrence, projection, debt-payoff, matching) |
| `npm run test:e2e` | Run the Playwright end-to-end suite against a production build |
| `npm run build` | Production build |

---

## Self-hosting with Docker

For a deploy that runs like any other self-hosted service (Unraid, a NAS, a VPS), use the bundled
image and compose file - the app and its own Postgres, no Node toolchain on the host.

```bash
cp .env.docker.example .env     # then edit .env
npx auth secret                 # generate a value for AUTH_SECRET in .env
docker compose up -d --build
```

Open <http://localhost:3000> (or whatever `APP_PORT` you set). On start the container waits for
Postgres, applies any pending database migrations automatically, then serves the app. Data lives in
the `moolah-db` Docker volume, so it survives restarts and image rebuilds.

The image is a multi-stage build producing Next.js [standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
output and runs as a non-root user. To update: `git pull && docker compose up -d --build`.

A prebuilt image is also published to GHCR on every push to `master`, so you don't
have to build locally: `ghcr.io/vinnymicale/moolah:latest`.

### Unraid

Use the bundled template so every field — image, WebUI link, port, and all variables — is
pre-filled. The **Add Container** page's "Template" dropdown only lists templates Unraid already
has on disk, so first drop the template file where it looks for them. On the Unraid box
(**Tools → Web Terminal**):

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-Moolah.xml \
  https://raw.githubusercontent.com/vinnymicale/moolah/master/unraid-template.xml
```

Then **Docker → Add Container**, open the **Template** dropdown, and pick **my-Moolah** (under
"User templates"). Every field populates. Set the three values that have no usable default
(`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL` — see the table below), leave the rest, and click
**Apply**. The app applies migrations on start, so an empty database is initialized
automatically. Open the container's **WebUI** link, or `http://<unraid-ip>:<port>`.

If you plan to use [scheduled backups](#backing-up-your-data-and-your-plaid-connections) to a local
folder, point the **Backups** path at a real share (it defaults to
`/mnt/user/appdata/moolah/backups`). It maps to `/backups` inside the container, where
`BACKUP_LOCAL_DIR` already points, so backups land on the host and survive container rebuilds. All of
this is editable later from the container's **Edit** screen.

Before first launch, create the database in your Postgres container:

```sql
CREATE USER moolah WITH PASSWORD 'moolah';
CREATE DATABASE moolah OWNER moolah;
```

#### Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes** | — | Connection string to your Postgres. On the default `bridge` network use the **Unraid host IP + published Postgres port** (container-name DNS only works on a shared custom network), e.g. `postgresql://moolah:moolah@192.168.1.10:5432/moolah`. |
| `AUTH_SECRET` | **yes** | — | Signs session tokens. Generate with `openssl rand -base64 33`. Keep it stable across updates, or existing logins are invalidated. |
| `ENCRYPTION_KEY` | no | _(uses `AUTH_SECRET`)_ | Key for encrypting stored Plaid/AI secrets. Optional, but **when restoring a backup from another instance it must match the source's key** (see [Backing up your data](#backing-up-your-data-and-your-plaid-connections)), or Plaid pages error. Setting a dedicated value lets `AUTH_SECRET` rotate independently. |
| `AUTH_URL` | **yes** | — | The URL you reach the app at, e.g. `http://192.168.1.10:5555`. Pins post-login redirects so they don't bounce to the container's internal hostname. |
| `AUTH_BYPASS` | no | `false` | Leave `false`. The no-password auto sign-in only works over localhost, so a LAN-reachable container must use a password (you set one on first load). |
| `AUTH_TRUST_HOST` | no | `true` | Lets Auth.js trust the proxy/host header. Leave as-is unless you front the app with something that rewrites it. |
| `DEMO_MODE` | no | `false` | `true` serves a seeded read-only sample dataset. Leave `false` for a real instance. |
| `PLAID_CLIENT_ID` | no | — | Only if you want automatic bank sync. From your Plaid dashboard. |
| `PLAID_SECRET` | no | — | Plaid API secret (matches `PLAID_ENV`). |
| `PLAID_ENV` | no | `sandbox` | `sandbox` for fake test data, `production` for real banks. |
| `BACKUP_LOCAL_DIR` | no | `/backups` | Where scheduled backups land for the **local** destination. The template pre-sets this to `/backups` and mounts it from the host via the **Backups** path, so leave it as-is unless you also change that mapping. Ignored for the Google Drive destination. |

---

## Read-only data API

Moolah exposes versioned, read-only `/api/v1` endpoints so external tools - e.g. a **Home
Assistant** dashboard on your network - can pull your numbers. Generate a personal token under
**Settings → Read-only API access** (shown once; only its hash is stored), then send it as a bearer
token:

```bash
curl -H "Authorization: Bearer moolah_…" http://localhost:3000/api/v1/summary
```

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/summary` | Net worth, safe-to-transfer, current-month budget status, upcoming bills |
| `GET /api/v1/net-worth` | Assets, liabilities, net, and per-account balances. Add `?range=3m\|1y\|all` for a daily history series and `?forecast=12` (1-24 months) for a net-worth projection |
| `GET /api/v1/accounts` | All non-archived accounts with balances |
| `GET /api/v1/budget` | Budget vs. actual per category (`?month=YYYY-MM` optional) |
| `GET /api/v1/upcoming` | Bills/income in the next N days (`?days=14`, 1-90) |

Pass `?tz=America/New_York` to anchor "today"/"this month" to your timezone (defaults to UTC).
Requests are rate-limited per token. Regenerating or revoking the token in Settings immediately
invalidates the old one.

### Home Assistant

Two ways to surface these numbers in Home Assistant:

- **Dedicated integration** ([`hass-moolah`](https://github.com/vinnymicale/hass-moolah)) - a
  companion custom component (HACS-style) that you point at your Moolah URL and paste the read-only
  token into during setup. It polls `/api/v1` and exposes sensors for net worth (current and
  12-month projection), assets, liabilities, safe-to-transfer, budget limit/spent/remaining, and
  upcoming bills - ready to drop onto a dashboard. Install it via HACS as a custom repository, or
  copy `custom_components/moolah` into your Home Assistant config.
- **No-integration option** - a built-in [RESTful
  sensor](https://www.home-assistant.io/integrations/sensor.rest/) polling `/api/v1/summary` with
  the bearer token works without installing anything.

---

## Connecting banks with Plaid (optional)

Create a free account at the [Plaid Dashboard](https://dashboard.plaid.com/), grab your keys from
**Developers → Keys**, and paste them into **Settings → Plaid bank sync** - they're stored
per-user (secret encrypted) so each account can use its own Plaid credentials. Alternatively, set
them in `.env` as an instance-wide fallback for users without their own keys:

```env
PLAID_CLIENT_ID="..."
PLAID_SECRET="..."           # use the secret that matches PLAID_ENV
PLAID_ENV="sandbox"          # "sandbox" = fake test data; "production" = your real banks
```

- **`sandbox`** lets you link Plaid's test institutions (use credentials like `user_good` /
  `pass_good`) with fake data - perfect for trying everything out at no cost.
- **`production`** connects your **real** banks. It requires requesting production access in the
  Plaid Dashboard, and Plaid **bills you per linked item (bank connection)** - so avoid
  re-linking the same bank (see [Backing up your data](#backing-up-your-data-and-your-plaid-connections)).
- Plaid's old **`development`** environment has been retired and is no longer an option.

Once set, use **Connect a bank** on the Accounts page; balances and posted transactions sync
automatically and are auto-categorised from the bank's category data. Linking is optional - manual
and CSV entry work without Plaid.

---

## Backing up your data (and your Plaid connections)

When you run locally, everything lives in the Postgres data directory `.pgdata/` in the project
root: accounts, transactions, budgets, goals - **and your Plaid access tokens** (the
`PlaidItem.accessToken` column). Lose `.pgdata/` and you have to re-link every bank, which on the
**production** Plaid environment is a fresh, *billed* connection each time. So if you connect real
banks, back this up.

A Plaid access token is tied to your `PLAID_CLIENT_ID` + `PLAID_SECRET` + `PLAID_ENV`, not to this
computer or database, so you can move it to another machine and keep the same connections.
**Restoring a saved token never costs a new Plaid item - only clicking "Connect a bank" does.**

### Two things have to travel together

Preserving your Plaid connections across a move takes **both** pieces below. Move the backup but
not the key and the connections are technically there, yet every Plaid page errors because the app
can't decrypt the credentials it needs to actually call Plaid.

1. **The data** - the backup file (or `.pgdata/`). It carries each bank's `accessToken` in **plain
   text**, so the tokens themselves restore fine on any machine, under any key.
2. **The encryption key** - your per-user **Plaid API keys** (`PLAID_CLIENT_ID` / `PLAID_SECRET`)
   and AI keys are stored **encrypted**, keyed off `ENCRYPTION_KEY` (or `AUTH_SECRET` if you never
   set one). The app decrypts your Plaid secret on every sync, so if the new host can't decrypt it,
   the access tokens are useless and Plaid pages fail. The key must match the source instance.

So the rule is: **copy the backup *and* set the same `ENCRYPTION_KEY` / `AUTH_SECRET` on the new
host before you restore.** (If your Plaid keys live only in `.env` as an instance-wide fallback,
rather than per-user in Settings, they aren't encrypted in the database - just copy that `.env` and
the key question is moot.) The full step-by-step is in the ⚠️ callout under Option A.

### Option A - one-command backup (recommended)

Export everything to a single JSON file (all tables, including the Plaid tokens):

```bash
npm run db:backup          # writes backups/moolah-backup-<timestamp>.json
```

Or, in the running app, go to **Settings → Back up everything → Download backup** to get the same
file in your browser. Copy it somewhere safe (external drive / cloud folder).

**To restore in the app:** go to **Settings → Restore from a backup**, pick a backup file, and
confirm. This overwrites the current database with the backup's contents, so you're signed out
afterward and log back in with the restored account. Ideal for the export → spin up Docker →
import-without-reconfiguring workflow.

**To restore from the CLI** (e.g. into a fresh clone):

```bash
npm install
npm run db:local           # start the bundled Postgres
npm run db:push            # create the (empty) schema
npm run db:restore -- ./path/to/moolah-backup-<timestamp>.json
```

Your banks reconnect with **no new Plaid items** and no re-linking. (`db:restore` only writes into an
empty database; pass `--force` to overwrite an existing one - the in-app restore always overwrites.)
The `backups/` folder is gitignored.

> ⚠️ **Moving to a new machine? Set the encryption key *before* you restore.** Restore the backup
> under a *different* key and decryption of your Plaid/AI secrets fails, surfacing as a "Something
> went wrong" error on the Accounts page (and anywhere Plaid is touched). The correct order on the
> new host is:
>
> 1. On the **old** instance, read its key: `grep -E 'ENCRYPTION_KEY|AUTH_SECRET' .env`.
> 2. On the **new** instance, set both `AUTH_SECRET` and `ENCRYPTION_KEY` to that value in `.env`
>    (Docker/Unraid: the same two environment variables), and restart so the new values take effect.
> 3. **Then** restore the backup (in-app or `npm run db:restore`).
>
> Setting a dedicated `ENCRYPTION_KEY` on both ends lets `AUTH_SECRET` rotate independently later.
> If the original key is truly lost, those encrypted secrets are unrecoverable - restore anyway
> (your data and access tokens come back), then clear and re-enter your Plaid/AI keys from Settings;
> because the access tokens are intact, re-entering the API keys reconnects the *same* Plaid items
> with **no new billed links**.

### Option B - raw data-directory copy

For a full cold copy you can also just back up the database folder itself:

1. **Stop the app** (so Postgres isn't writing mid-copy).
2. Copy the **`.pgdata/`** directory and your **`.env`** file somewhere safe.
3. **To restore**, drop both back into place. **If the backup was copied through Windows** (e.g. a
   OneDrive/Desktop folder, common with WSL), `.pgdata/` comes back world-readable and Postgres
   refuses to start with a *"data directory has invalid permissions"* error. Fix it once:
   ```bash
   chmod 700 .pgdata             # Postgres requires the data dir to be 0700 (or 0750)
   rm -f .pgdata/postmaster.pid  # clear any stale lockfile copied from a running server
   ```
   Then start the app. (Option A avoids this entirely, since it restores into a fresh `.pgdata`.)

> ⚠️ Treat any backup as a secret - the Plaid access tokens are stored **unencrypted** and grant
> access to your bank data. Keep them somewhere private.

> Never run `npm run db:reset` or delete `.pgdata/` without a current backup - both wipe your tokens.

### Option C - scheduled automatic backups

If your instance stays running (self-hosted Docker, Unraid, or `npm start`), it can take the Option A
backup for you on a schedule. Go to **Settings → Scheduled backups** and set:

- **Destination** - a local folder/mounted volume, or **Google Drive**.
- **Frequency** - daily or weekly, at a chosen hour (server local time).
- **Copies to keep** - retention. Once a new backup pushes the count over this, the oldest is
  deleted. "Keep 5" with a daily schedule means a rolling 5-day window.

A **Run backup now** button takes one on demand, and the section shows the last run's time and
result. The backups are the exact same JSON snapshot as Option A, so any of them can be restored via
**Settings → Restore from a backup** or `npm run db:restore`.

This runs inside the app process, so it only fires while the server is up - it's meant for an
always-on host, not serverless. It's disabled in demo mode.

**Local destination:** backups are written to `BACKUP_LOCAL_DIR` (default `./backups`). In Docker,
set it to a mounted volume like `/backups` so copies survive container rebuilds.

**Google Drive destination:** uses an OAuth refresh token rather than a browser sign-in at backup
time, so it works headless. One-time setup:

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an OAuth
   client of type **Web application** and add `https://developers.google.com/oauthplayground` as an
   **authorized redirect URI**. Note its **client ID** and **client secret**. Also enable the
   **Google Drive API** for the project, and add your own Google account under **Test users** on the
   OAuth consent screen (otherwise the authorization is rejected).
2. Get a **refresh token** for that client via the
   [OAuth Playground](https://developers.google.com/oauthplayground/): open the gear menu, tick
   **Use your own OAuth credentials**, and paste your client ID/secret. In step 1, select the
   `https://www.googleapis.com/auth/drive.file` scope and **Authorize APIs**; in step 2,
   **Exchange authorization code for tokens**. Copy the **refresh token** from the response (it
   starts with `1//`). A Web-application client is needed here rather than a Desktop one because the
   Playground signs in through that redirect URI.
3. Create a folder in Drive for the backups and copy its **folder ID** (the last segment of the
   folder's URL).
4. Paste the client ID, client secret, refresh token, and folder ID into **Settings → Scheduled
   backups → Google Drive**. They're encrypted at rest with `ENCRYPTION_KEY` and never sent back to
   the browser.

Backups are uploaded into that folder, and retention only prunes Moolah's own
`moolah-backup-*.json` files there - anything else in the folder is left alone.

---

## How the cash projection works

Each cash account (checking/savings/cash flagged "include in cash flow") has a `currentBalance`
that's treated as the truth **as of today**. For any calendar day the projected end-of-day balance
is `todayBalance + (cumulative signed transactions up to that day - cumulative up to today)`, where
income is `+` and expense is `-`. This single formula reconstructs past days and projects future
ones - including not-yet-cleared and recurring items. The logic lives in
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
scripts/           setup.ts (first-run schema), local-db.ts (embedded Postgres runner)
src/
  app/(auth)/      sign-in
  app/(app)/       dashboard, calendar, notifications, transactions, accounts, networth,
                   recurring, budgets, goals, debt, categories, trends, settings
  app/api/         plaid (link/exchange/sync/recategorize), export (CSV),
                   backup (download/import), v1 (read-only API), chat (AI assistant), health
  actions/         server actions (mutations)
  lib/             prisma, auth/session, money, dates, recurrence, projection,
                   calendar, reports, queries/, plaid-sync, debt-payoff, milestones,
                   budget-suggestions, notifications/ (triggers, engine, Discord delivery),
                   snapshots (net-worth history),
                   networth-forecast, backup/ (full export/restore, Google Drive),
                   crypto (secret encryption), api-auth (token auth)
  components/      AppChrome, Sidebar, CommandPalette, MultiSelect, TransactionModal,
                   Modal, Toast, AnimatedNumber, Sparkline, charts, icons
```

---

## Support

Moolah is free and self-hosted. If you find it useful and want to support its development, you can
[**buy me a coffee** ☕](https://buymeacoffee.com/vinnymicale) - entirely optional, and always
appreciated.

---

## Disclaimer

Moolah was developed with assistance from AI (Anthropic's Claude). It is a personal
project provided **as-is, without warranty of any kind**, express or implied. You run it at your own
risk: review the code before trusting it with real financial data, keep your own backups, and
remember that anything it shows you (projections, "safe to transfer", debt payoff, net worth) is for
informational purposes only and is **not financial advice**. You are responsible for the security of
your own deployment, credentials, and Plaid access tokens.

Moolah is released under the [MIT License](LICENSE) - you're free to use, modify, and self-host it.
