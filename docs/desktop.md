# Household Finance — Windows desktop app

This packages the whole app (web server + database) into a normal Windows
application: a double-click launches it, it gets a Start Menu / desktop icon, and
there's no terminal. Under the hood, Electron starts an embedded PostgreSQL
server and the Next.js server, then opens a window pointed at them.

## How it works

On launch, the Electron main process ([electron/main.js](../electron/main.js)):

1. Loads config/secrets from `%APPDATA%\Household Finance\config.json`
   (auto-created; `AUTH_SECRET` is generated once).
2. Starts embedded PostgreSQL, data persisted in
   `%APPDATA%\Household Finance\pgdata`.
3. Runs `prisma db push` to bring the schema up to date.
4. Starts the Next.js standalone server on `http://localhost:5839`.
5. Opens the app window.

On quit, it shuts the server and Postgres down.

## Building the installer (do this on Windows)

The installer must be built **on a Windows machine** (the embedded Postgres
binaries and the NSIS installer are Windows-specific).

```powershell
git clone https://github.com/vinnymicale/household-finance.git
cd household-finance
npm install
npm run desktop:build
```

The installer lands in `dist-desktop\` (e.g. `Household Finance Setup 0.1.0.exe`).
Run it to install. First launch takes a few extra seconds while Postgres
initialises its data directory.

> Tip: drop a 256×256 `icon.ico` at `build-desktop/icon.ico` to brand the app and
> installer (see the commented `icon:` line in `electron-builder.yml`).

## Configuring Plaid / Google sign-in

After the first launch, edit `%APPDATA%\Household Finance\config.json`:

```json
{
  "AUTH_SECRET": "(generated for you)",
  "AUTH_DEV_LOGIN": "true",
  "PLAID_CLIENT_ID": "your-plaid-client-id",
  "PLAID_SECRET": "your-plaid-secret",
  "PLAID_ENV": "production",
  "ALLOWED_EMAILS": "",
  "AUTH_GOOGLE_ID": "",
  "AUTH_GOOGLE_SECRET": ""
}
```

- **Plaid keys are required** — the app initialises the Plaid client on startup.
- `AUTH_DEV_LOGIN` defaults to `true`: a password-less login, which is fine on
  your own machine. To use Google sign-in instead, set it to `false`, fill in the
  Google credentials, and register `http://localhost:5839/api/auth/callback/google`
  as an authorized redirect URI in Google Cloud.

Restart the app after editing the config.

## Your data

Everything lives in `%APPDATA%\Household Finance\pgdata`. It is **not** touched by
reinstalls or updates, so upgrading the app keeps all your accounts and
transactions. To start fresh, delete that folder.

## Migrating your existing data (keep your Plaid connections)

Plaid's connection limit counts **Items** (one per linked institution) that live
on Plaid's side, tied to your Plaid credentials — not to any one database. A
fresh database with no access tokens means re-linking, which creates **new**
Items and spends against your limit (and the old ones keep counting until
removed).

To avoid that, move your data — including the stored Plaid access tokens — from
your current install into the desktop app. The app then adopts your existing
connections and **creates nothing new**.

1. On your current (WSL/dev) machine, with the database running
   (`npm run db:local` in another terminal):
   ```bash
   npm run export:data
   ```
   This writes `household-finance-export.json`.
2. Copy that file to your Windows machine.
3. Launch the desktop app once (it creates an empty database), then quit it.
4. Put the file at `%APPDATA%\Household Finance\import.json`.
5. Launch the app again. On startup it detects the file, loads it into the empty
   database (FK checks are disabled during the load, the whole thing is one
   transaction), and renames it to `import.done.json`. Your accounts,
   transactions, and **live Plaid connections** are all there — no new Items.

The import only runs into an **empty** database, so it never overwrites data you
already entered in the desktop app.

## Pulling in future updates

You have two options:

### Option 1 — Rebuild and reinstall (simplest)

```powershell
git pull
npm install
npm run desktop:build
```

Run the new installer from `dist-desktop\`. It upgrades the app in place; your
data is preserved, and `prisma db push` applies any schema changes automatically
on the next launch.

### Option 2 — Automatic in-app updates (set up once)

The app already includes the update client ([electron/updater.js](../electron/updater.js))
and an `electron-builder.yml` `publish` block pointing at GitHub Releases. To use it:

1. Create a GitHub personal access token with `repo` scope and set it as
   `GH_TOKEN` in your shell.
2. Bump the `version` in `package.json`, then publish:
   ```powershell
   npm run build
   npx electron-builder --win --publish always
   ```
   This builds the installer and uploads it (plus a `latest.yml` manifest) to a
   GitHub Release.

Installed copies then check for updates on launch, download in the background,
and prompt to restart-and-install. No reinstall needed by the user.

> Note: unsigned Windows apps trigger a SmartScreen warning on first install and
> on updates. Auto-update still works, but for a seamless experience you'd want a
> code-signing certificate (`win.certificateFile` / `certificatePassword` in
> `electron-builder.yml`). Optional for personal use.
