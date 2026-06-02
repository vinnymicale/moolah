/**
 * Starts a real PostgreSQL server locally with no Docker, no sudo, and no
 * system install — the binary is downloaded by the `embedded-postgres` package.
 * Connection details match the default DATABASE_URL in .env:
 *
 *     postgresql://finance:finance@localhost:5433/finance
 *
 * Usage:  npm run db:local      (leave it running in its own terminal)
 */
import { existsSync } from "node:fs";
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

  let alreadyRunning = false;
  try {
    await pg.start();
    console.log(`Postgres started on port ${PORT}.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("postmaster.pid") || msg.includes("already exists") || msg.includes("already running")) {
      alreadyRunning = true;
      console.log(`Postgres is already running on port ${PORT} — attaching.`);
    } else {
      throw err;
    }
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
