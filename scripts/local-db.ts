/**
 * Starts a real PostgreSQL server locally with no Docker, no sudo, and no
 * system install — the binary is downloaded by the `embedded-postgres` package.
 * Connection details match the default DATABASE_URL in .env:
 *
 *     postgresql://finance:finance@localhost:5433/finance
 *
 * Usage:  npm run db:local      (leave it running in its own terminal)
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const DATA_DIR = resolve(process.cwd(), ".pgdata");
const PORT = 5433;
const USER = "finance";
const PASSWORD = "finance";
const DB_NAME = "finance";

async function main() {
  const firstRun = !existsSync(DATA_DIR);

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  });

  if (firstRun) {
    console.log("Initialising a fresh Postgres data directory at .pgdata …");
    await pg.initialise();
  }

  // Check if another postgres process is already running in our data dir
  // by reading the PID from postmaster.pid and seeing if that process is alive.
  const pidFile = resolve(DATA_DIR, "postmaster.pid");
  let alreadyRunning = false;
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, "utf8").split("\n")[0], 10);
      // Signal 0 just checks for process existence without sending a signal.
      process.kill(pid, 0);
      alreadyRunning = true;
      console.log(`Postgres is already running (PID ${pid}) on port ${PORT} — attaching.`);
    } catch {
      // PID file exists but process is gone — stale lockfile, proceed to start normally.
    }
  }

  if (!alreadyRunning) {
    await pg.start();
    console.log(`Postgres started on port ${PORT}.`);
  }

  try {
    await pg.createDatabase(DB_NAME);
    console.log(`Created database "${DB_NAME}".`);
  } catch {
    // Database already exists — fine.
  }

  console.log(
    `\n  Ready ➜  postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}\n`,
  );
  console.log("Leave this running. Press Ctrl+C to stop.\n");

  const shutdown = async () => {
    console.log("\nStopping Postgres …");
    // Only stop the server if we're the one who started it.
    if (!alreadyRunning) await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
