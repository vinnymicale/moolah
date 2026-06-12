/**
 * One-command first-run setup. Starts the bundled embedded Postgres (no Docker,
 * no system install), syncs the Prisma schema to it, then stops the database.
 * After this you can run the app with `npm run start:all`.
 *
 *   npm run setup            # create the schema
 *   npm run setup -- --seed  # also load the demo data
 */
import { execSync } from "node:child_process";
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

  // If a Postgres is already running in our data dir (e.g. `npm run db:local`
  // in another terminal), attach to it rather than trying to start a second.
  const pidFile = resolve(DATA_DIR, "postmaster.pid");
  let weStarted = false;
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, "utf8").split("\n")[0], 10);
      process.kill(pid, 0); // signal 0 = liveness check only
      console.log(`Postgres is already running (PID ${pid}) - using it.`);
    } catch {
      await pg.start();
      weStarted = true;
    }
  } else {
    await pg.start();
    weStarted = true;
  }

  try {
    await pg.createDatabase(DB_NAME);
  } catch {
    // Database already exists - fine.
  }

  console.log("Syncing the database schema …");
  execSync("prisma db push", { stdio: "inherit" });

  if (process.argv.includes("--seed")) {
    console.log("Loading the demo data …");
    execSync("tsx prisma/seed.ts", { stdio: "inherit" });
  }

  // Leave an attached server alone; only stop one we started ourselves.
  if (weStarted) await pg.stop();

  console.log("\n✓ Setup complete. Start Moolah with:  npm run start:all\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
