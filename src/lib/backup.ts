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

// Tables with no userId column, reachable through a user-scoped parent.
const CHILD_FILTERS: Record<string, string> = {
  AccountSnapshot: '"accountId" IN (SELECT id FROM "FinancialAccount" WHERE "userId" = $1)',
  PlaidLinkedAccount: '"plaidItemId" IN (SELECT id FROM "PlaidItem" WHERE "userId" = $1)',
};

/**
 * Dump only the rows belonging to one user. Same payload shape as
 * exportAllData, so it restores with the same importer. Tables are scoped by
 * their userId column (detected from the schema), by id for User itself, or by
 * the CHILD_FILTERS subqueries for child tables. Tables with no relationship to
 * a user (e.g. VerificationToken) are skipped rather than risk including
 * another user's rows.
 */
export async function exportUserData(userId: string, databaseUrl?: string): Promise<BackupPayload> {
  const client = new Client({ connectionString: requireUrl(databaseUrl) });
  await client.connect();
  try {
    const { rows: tables } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const { rows: userIdCols } = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'userId'",
    );
    const hasUserId = new Set(userIdCols.map((r) => r.table_name));

    const out: BackupTable[] = [];
    for (const { tablename } of tables) {
      if (EXCLUDE.has(tablename)) continue;
      let where: string;
      if (tablename === "User") where = "id = $1";
      else if (hasUserId.has(tablename)) where = '"userId" = $1';
      else if (CHILD_FILTERS[tablename]) where = CHILD_FILTERS[tablename];
      else continue;
      const { rows } = await client.query(`SELECT * FROM "${tablename}" WHERE ${where}`, [userId]);
      out.push({ table: tablename, rows });
    }
    return { app: "moolah", version: 1, exportedAt: new Date().toISOString(), tables: out };
  } finally {
    await client.end();
  }
}

/**
 * Order tables parents-before-children from the live FK graph, so inserting in
 * this order never references a row that isn't loaded yet. Self-references and
 * cycles are tolerated (a cyclic edge is just dropped from the ordering); paired
 * with INSERT ... ON CONFLICT DO NOTHING that's good enough for a restore. Used
 * only on the non-superuser path, where we can't disable FK checks outright.
 */
function topoSortTables(tables: string[], deps: Map<string, Set<string>>): string[] {
  const remaining = new Set(tables);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    // A table is ready when all its parents are already placed (or absent from
    // this backup). Pick the lexicographically first ready table for stable output.
    const ready = [...remaining]
      .filter((t) => {
        const parents = deps.get(t);
        if (!parents) return true;
        return [...parents].every((p) => p === t || !remaining.has(p));
      })
      .sort();
    if (ready.length === 0) {
      // A cycle among the leftovers - append them in stable order and let
      // ON CONFLICT / a single transaction sort out the rest.
      ordered.push(...[...remaining].sort());
      break;
    }
    for (const t of ready) {
      ordered.push(t);
      remaining.delete(t);
    }
  }
  return ordered;
}

/**
 * Load a backup into the database, all in one transaction that rolls back on
 * error. Refuses to run if the DB already has data unless `force` is set, which
 * truncates the backed-up tables first.
 *
 * FK checks are disabled for the load via `session_replication_role` so table
 * order doesn't matter - but that's superuser-only. When the connecting role
 * isn't a superuser (a self-hosted `moolah` user that merely owns its database,
 * managed Postgres, etc.) we fall back to inserting tables in FK-dependency
 * order instead, which needs no special privilege.
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
    // Identifiers (table/column names) from the backup can't be bound as query
    // params, so they're interpolated. Validate every one against the live
    // schema first - an uploaded file is untrusted input. Anything not a real
    // public column of a real public table is rejected, so the strings that
    // reach the SQL below come from this allowlist, not from the payload.
    const { rows: schemaCols } = await client.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
    );
    // Map each known identifier to its already-quoted, schema-derived literal.
    // ident() looks the payload's name up here and returns the *stored* string,
    // so the text that reaches the SQL below originates from the database, never
    // from the uploaded file - no untrusted value is ever interpolated.
    const tableLiteral = new Map<string, string>();
    const colLiteral = new Map<string, Map<string, string>>();
    for (const { table_name, column_name } of schemaCols) {
      tableLiteral.set(table_name, `"${table_name}"`);
      if (!colLiteral.has(table_name)) colLiteral.set(table_name, new Map());
      colLiteral.get(table_name)!.set(column_name, `"${column_name}"`);
    }
    const tableIdentOf = (table: string): string => {
      const lit = tableLiteral.get(table);
      if (lit === undefined) throw new Error(`Backup references unknown table "${table}"`);
      return lit;
    };
    const colIdentOf = (table: string, col: string): string => {
      const lit = colLiteral.get(table)?.get(col);
      if (lit === undefined) {
        throw new Error(`Backup references unknown column "${col}" on table "${table}"`);
      }
      return lit;
    };

    const { rows } = await client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM "User"');
    const hasData = rows[0].n > 0;
    if (hasData && !opts.force) {
      throw new Error(
        "Database already has data. Restore into a fresh/empty database, or pass --force to overwrite it.",
      );
    }

    // Only a superuser can flip session_replication_role to skip FK checks. Probe
    // it (usesuper is null for non-superusers); if we can't, we'll order inserts
    // by FK dependency instead so a child never lands before its parent.
    const { rows: superRows } = await client.query<{ super: boolean }>(
      "SELECT usesuper AS super FROM pg_user WHERE usename = current_user",
    );
    const canDisableFks = superRows[0]?.super === true;

    // Insert order: arbitrary when FK checks are off, else parents-before-children.
    let loadOrder = tables;
    if (!canDisableFks) {
      const { rows: fks } = await client.query<{ child: string; parent: string }>(
        `SELECT tc.table_name AS child, ccu.table_name AS parent
           FROM information_schema.table_constraints tc
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
      );
      const deps = new Map<string, Set<string>>();
      for (const { child, parent } of fks) {
        if (!deps.has(child)) deps.set(child, new Set());
        deps.get(child)!.add(parent);
      }
      const order = topoSortTables(
        tables.map((t) => t.table),
        deps,
      );
      const byName = new Map(tables.map((t) => [t.table, t]));
      loadOrder = order.map((name) => byName.get(name)!).filter(Boolean);
    }

    await client.query("BEGIN");
    if (canDisableFks) await client.query("SET session_replication_role = replica");

    if (hasData && opts.force) {
      // TRUNCATE ... CASCADE clears child rows regardless of order, so the raw
      // table list is fine here even on the dependency-ordered path.
      const names = tables.map((t) => tableIdentOf(t.table)).join(", ");
      if (names) await client.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
    }

    let imported = 0;
    for (const { table, rows: tableRows } of loadOrder) {
      const tableIdent = tableIdentOf(table);
      for (const row of tableRows) {
        const cols = Object.keys(row);
        if (cols.length === 0) continue;
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
        const colList = cols.map((c) => colIdentOf(table, c)).join(",");
        const values = cols.map((c) => row[c]);
        await client.query(
          `INSERT INTO ${tableIdent} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        );
        imported++;
      }
    }

    if (canDisableFks) await client.query("SET session_replication_role = DEFAULT");
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
