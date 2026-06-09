/**
 * Full database backup → a single timestamped JSON file under ./backups.
 * Includes the Plaid access tokens, so restoring it keeps your linked banks
 * without re-linking (no new Plaid items).
 *
 * Prerequisite: the database must be running (e.g. `npm run db:local`).
 * Usage:  npm run db:backup
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportAllData, backupStamp } from "../src/lib/backup";

async function main() {
  const payload = await exportAllData();
  const total = payload.tables.reduce((s, t) => s + t.rows.length, 0);
  for (const t of payload.tables) console.log(`  ${t.table}: ${t.rows.length} rows`);

  const dir = resolve(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `moolah-backup-${backupStamp(payload.exportedAt)}.json`);
  writeFileSync(file, JSON.stringify(payload));

  console.log(`\nWrote ${file}`);
  console.log(`(${total} rows across ${payload.tables.length} tables - includes Plaid access tokens.)`);
  console.log("Keep this file private and copy it somewhere safe; it can restore your linked banks.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
