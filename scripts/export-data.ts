/**
 * Exports all data from the current (WSL/dev) database to a single JSON file,
 * so it can be loaded into the Windows desktop app on first launch WITHOUT
 * re-linking Plaid — the existing access tokens move with the data, so no new
 * Plaid Items are created.
 *
 * Prerequisites: the database must be running (e.g. `npm run db:local`).
 *
 * Usage:  npm run export:data
 *
 * Then copy the produced `household-finance-export.json` to your Windows machine
 * and drop it at:  %APPDATA%\Household Finance\import.json
 * The desktop app imports it automatically on its next launch (into an empty DB).
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

// Prisma's migration bookkeeping table — never present after `db push`, and the
// desktop DB won't have it, so don't export it.
const EXCLUDE = new Set(["_prisma_migrations"]);

async function main() {
  const url =
    process.env.DATABASE_URL ?? "postgresql://finance:finance@localhost:5433/finance";
  const client = new Client({ connectionString: url });
  await client.connect();

  const { rows: tables } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );

  const out: { table: string; rows: Record<string, unknown>[] }[] = [];
  let total = 0;
  for (const { tablename } of tables) {
    if (EXCLUDE.has(tablename)) continue;
    const { rows } = await client.query(`SELECT * FROM "${tablename}"`);
    out.push({ table: tablename, rows });
    total += rows.length;
    console.log(`  ${tablename}: ${rows.length} rows`);
  }

  await client.end();

  const file = resolve(process.cwd(), "household-finance-export.json");
  writeFileSync(file, JSON.stringify(out));
  console.log(`\nWrote ${file} (${total} rows across ${out.length} tables).`);
  console.log("\nNext steps:");
  console.log("  1. Copy that file to your Windows machine.");
  console.log("  2. Launch the desktop app once (creates an empty database), then quit it.");
  console.log("  3. Place the file at:  %APPDATA%\\Household Finance\\import.json");
  console.log("  4. Launch the app again — it imports the data and adopts your");
  console.log("     existing Plaid connections (no new Items are created).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
