// Full-database backup / restore as a single JSON payload.
//
// The export dumps every row of every table in the public schema - including
// the PlaidItem access tokens - so a restore reconstructs the app exactly,
// keeping your linked banks WITHOUT re-linking (no new, billed Plaid items).
//
// Uses a raw pg connection (not Prisma) so it's schema-agnostic: new tables are
// picked up automatically. Shared by the CLI scripts (db:backup / db:restore)
// and the in-app "Download backup" button.

import { Client } from "pg";

// Prisma's migration bookkeeping table - not part of the app's data.
const EXCLUDE = new Set(["_prisma_migrations"]);

export interface BackupTable {
  table: string;
  rows: Record<string, unknown>[];
}

export interface BackupPayload {
  app: "moolah";
  version: 1;
  exportedAt: string; // ISO timestamp
  tables: BackupTable[];
}

export interface ImportResult {
  imported: number;
  tables: number;
}

function requireUrl(url?: string): string {
  const u = url ?? process.env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL is not set");
  return u;
}

/** A filename-safe timestamp derived from a backup's exportedAt, e.g. 2026-06-04_18-30-00. */
export function backupStamp(iso: string): string {
  return iso.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

/** Dump every row of every public table to a JSON-serialisable payload. */
export async function exportAllData(databaseUrl?: string): Promise<BackupPayload> {
  const client = new Client({ connectionString: requireUrl(databaseUrl) });
  await client.connect();
  try {
    const { rows: tables } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const out: BackupTable[] = [];
    for (const { tablename } of tables) {
      if (EXCLUDE.has(tablename)) continue;
      const { rows } = await client.query(`SELECT * FROM "${tablename}"`);
      out.push({ table: tablename, rows });
    }
    return { app: "moolah", version: 1, exportedAt: new Date().toISOString(), tables: out };
  } finally {
    await client.end();
  }
}

/**
 * Load a backup into the database. FK checks are disabled for the load (so table
 * order doesn't matter) and it all runs in one transaction that rolls back on
 * error. Refuses to run if the DB already has data unless `force` is set, which
 * truncates the backed-up tables first.
 */
export async function importAllData(
  payload: BackupPayload | BackupTable[],
  databaseUrl?: string,
  opts: { force?: boolean } = {},
): Promise<ImportResult> {
  const tables = Array.isArray(payload) ? payload : payload.tables;
  const client = new Client({ connectionString: requireUrl(databaseUrl) });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM "Household"');
    const hasData = rows[0].n > 0;
    if (hasData && !opts.force) {
      throw new Error(
        "Database already has data. Restore into a fresh/empty database, or pass --force to overwrite it.",
      );
    }

    await client.query("BEGIN");
    await client.query("SET session_replication_role = replica"); // disable FK checks during load

    if (hasData && opts.force) {
      const names = tables.map((t) => `"${t.table}"`).join(", ");
      if (names) await client.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
    }

    let imported = 0;
    for (const { table, rows: tableRows } of tables) {
      for (const row of tableRows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
        const colList = cols.map((c) => `"${c}"`).join(",");
        const values = cols.map((c) => row[c]);
        await client.query(
          `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        );
        imported++;
      }
    }

    await client.query("SET session_replication_role = DEFAULT");
    await client.query("COMMIT");
    return { imported, tables: tables.length };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    await client.end();
  }
}
