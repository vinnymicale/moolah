// Electron main process for Household Finance.
//
// On launch it:
//   1. loads/creates the local config (secrets) in the user-data dir,
//   2. starts an embedded PostgreSQL server (data persisted in user-data),
//   3. reconciles the DB schema with `prisma db push`,
//   4. starts the Next.js standalone server as a child process,
//   5. opens a window pointed at it.
// On quit it tears the child server and Postgres down again.

const { app, BrowserWindow, dialog, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const EmbeddedPostgres = require("embedded-postgres");
const { maybeImportData } = require("./import-data");

// In a packaged app, bundled files live under process.resourcesPath; in dev they
// live in the project root.
const isPackaged = app.isPackaged;
const RES = isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const APP_DIR = isPackaged ? path.join(RES, "app") : path.join(RES, ".next", "standalone");

const PG_PORT = 5433;
const PG_USER = "finance";
const PG_PASSWORD = "finance";
const PG_DB = "finance";
const APP_PORT = 5839; // fixed local port (must match Google OAuth redirect, if used)
const APP_URL = `http://localhost:${APP_PORT}`;

let mainWindow = null;
let pg = null;
let serverChild = null;
let shuttingDown = false;

// ── Config / secrets ──────────────────────────────────────────────────────────
// Stored at <userData>/config.json. AUTH_SECRET is generated once. Plaid keys
// must be filled in by the user (the app needs them to start).
function loadConfig() {
  const file = path.join(app.getPath("userData"), "config.json");
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* recreate below */ }
  }
  let changed = false;
  if (!cfg.AUTH_SECRET) { cfg.AUTH_SECRET = crypto.randomBytes(33).toString("base64"); changed = true; }
  if (cfg.AUTH_DEV_LOGIN === undefined) { cfg.AUTH_DEV_LOGIN = "true"; changed = true; }
  if (cfg.PLAID_CLIENT_ID === undefined) { cfg.PLAID_CLIENT_ID = ""; changed = true; }
  if (cfg.PLAID_SECRET === undefined) { cfg.PLAID_SECRET = ""; changed = true; }
  if (cfg.PLAID_ENV === undefined) { cfg.PLAID_ENV = "production"; changed = true; }
  if (cfg.ALLOWED_EMAILS === undefined) { cfg.ALLOWED_EMAILS = ""; changed = true; }
  if (cfg.AUTH_GOOGLE_ID === undefined) { cfg.AUTH_GOOGLE_ID = ""; changed = true; }
  if (cfg.AUTH_GOOGLE_SECRET === undefined) { cfg.AUTH_GOOGLE_SECRET = ""; changed = true; }
  if (changed) fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return { cfg, file };
}

function serverEnv(cfg) {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(APP_PORT),
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`,
    NEXTAUTH_URL: APP_URL,
    AUTH_TRUST_HOST: "true",
    AUTH_SECRET: cfg.AUTH_SECRET,
    AUTH_DEV_LOGIN: String(cfg.AUTH_DEV_LOGIN),
    AUTH_GOOGLE_ID: cfg.AUTH_GOOGLE_ID || "",
    AUTH_GOOGLE_SECRET: cfg.AUTH_GOOGLE_SECRET || "",
    ALLOWED_EMAILS: cfg.ALLOWED_EMAILS || "",
    PLAID_CLIENT_ID: cfg.PLAID_CLIENT_ID || "",
    PLAID_SECRET: cfg.PLAID_SECRET || "",
    PLAID_ENV: cfg.PLAID_ENV || "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

// ── Postgres ──────────────────────────────────────────────────────────────────
async function startPostgres() {
  const dataDir = path.join(app.getPath("userData"), "pgdata");
  const firstRun = !fs.existsSync(dataDir);

  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
  });

  if (firstRun) await pg.initialise();
  await pg.start();
  try { await pg.createDatabase(PG_DB); } catch { /* already exists */ }
}

// ── Schema sync (prisma db push) ───────────────────────────────────────────────
function runSchemaSync(cfg) {
  return new Promise((resolve, reject) => {
    // Bundled, unpacked: prisma CLI + schema live under resources/prisma-cli.
    const prismaDir = isPackaged ? path.join(RES, "prisma-cli") : RES;
    const prismaBin = path.join(prismaDir, "node_modules", "prisma", "build", "index.js");
    const schemaPath = path.join(prismaDir, "prisma", "schema.prisma");
    const dbUrl = serverEnv(cfg).DATABASE_URL;
    // Prisma 7's `db push` takes --schema/--url directly (no --skip-generate flag)
    // and does not run generate, so the bundled CLI needs no generator output dir.
    const child = spawn(
      process.execPath,
      [prismaBin, "db", "push", "--schema", schemaPath, "--url", dbUrl, "--accept-data-loss"],
      { cwd: prismaDir, env: { ...serverEnv(cfg), ELECTRON_RUN_AS_NODE: "1" } },
    );
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.stdout.on("data", (d) => { process.stdout.write(d); });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`prisma db push failed (${code})\n${err}`))));
    child.on("error", reject);
  });
}

// ── Next.js standalone server ──────────────────────────────────────────────────
function startServer(cfg) {
  serverChild = spawn(process.execPath, [path.join(APP_DIR, "server.js")], {
    cwd: APP_DIR,
    env: serverEnv(cfg),
  });
  serverChild.stdout.on("data", (d) => process.stdout.write(d));
  serverChild.stderr.on("data", (d) => process.stderr.write(d));
  serverChild.on("exit", (code) => {
    if (!shuttingDown) {
      dialog.showErrorBox("Household Finance", `The app server stopped unexpectedly (code ${code}).`);
      app.quit();
    }
  });
}

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(APP_URL, () => resolve());
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("Server did not start in time"));
        else setTimeout(ping, 400);
      });
      req.end();
    };
    ping();
  });
}

// ── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Household Finance",
    backgroundColor: "#111113",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Open external links (e.g. Plaid, Google sign-in) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(APP_URL);
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
async function boot() {
  const { cfg } = loadConfig();
  try {
    await startPostgres();
    await runSchemaSync(cfg);
    // One-time data migration from another machine, if an export was dropped in.
    await maybeImportData(
      { host: "localhost", port: PG_PORT, user: PG_USER, password: PG_PASSWORD, database: PG_DB },
      app.getPath("userData"),
      (m) => console.log(m),
    );
    startServer(cfg);
    await waitForServer();
    createWindow();
  } catch (e) {
    dialog.showErrorBox("Household Finance — startup failed", String(e && e.stack ? e.stack : e));
    app.quit();
  }
}

async function shutdown() {
  shuttingDown = true;
  try { if (serverChild) serverChild.kill(); } catch { /* ignore */ }
  try { if (pg) await pg.stop(); } catch { /* ignore */ }
}

// Single-instance lock so two launches don't fight over the DB port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    boot();
    // Wire auto-updates (no-op in dev / when no feed configured).
    try { require("./updater").initAutoUpdates(); } catch { /* optional */ }
  });

  app.on("window-all-closed", async () => { await shutdown(); app.quit(); });
  app.on("before-quit", async (e) => {
    if (!shuttingDown) { e.preventDefault(); await shutdown(); app.quit(); }
  });
}
