/**
 * Restore a backup produced by `npm run db:backup` (or the in-app "Download
 * backup" button) into the database. Because the backup carries the Plaid
 * access tokens, your linked banks come back without re-linking.
 *
 * Prerequisites: the database must be running and the schema applied
 * (`npm run db:local` + `npm run db:push`). By default it only restores into an
 * EMPTY database; pass --force to overwrite an existing one.
 *
 * Usage:  npm run db:restore -- ./backups/moolah-backup-YYYY-MM-DD_HH-MM-SS.json [--force]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importAllData, type BackupPayload } from "../src/lib/backup";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const fileArg = args.find((a) => !a.startsWith("--"));
  if (!fileArg) {
    console.error("Usage: npm run db:restore -- <path-to-backup.json> [--force]");
    process.exit(1);
  }

  const file = resolve(process.cwd(), fileArg);
  const payload = JSON.parse(readFileSync(file, "utf8")) as BackupPayload;

  const res = await importAllData(payload, undefined, { force });
  console.log(`Restored ${res.imported} rows across ${res.tables} tables from ${file}.`);
  console.log("Your linked banks were restored with their existing tokens - no re-linking needed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
