// First-launch data import for the desktop app.
//
// If <userData>/import.json exists and the database is still empty, this loads
// the exported rows (from `npm run export:data` on the old machine) into the
// freshly db-push'd schema. Because the export includes the PlaidItem access
// tokens, the desktop app adopts the existing Plaid connections — no new Plaid
// Items are created, so nothing is spent against the connection limit.
//
// FK constraints are disabled during the load (session_replication_role =
// replica) so table order doesn't matter; the whole thing runs in one
// transaction and rolls back on any error.

const fs = require("node:fs");
const path = require("node:path");

async function maybeImportData(connConfig, userDataDir, log = () => {}) {
  const importFile = path.join(userDataDir, "import.json");
  if (!fs.existsSync(importFile)) return;

  const { Client } = require("pg");
  const client = new Client(connConfig);
  await client.connect();

  try {
    // Only import into an empty database, so we never clobber existing data.
    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM "Household"');
    if (rows[0].n > 0) {
      log("Database already has data — skipping import.json.");
      return;
    }

    const data = JSON.parse(fs.readFileSync(importFile, "utf8"));

    await client.query("BEGIN");
    await client.query("SET session_replication_role = replica"); // disable FK checks during load

    let imported = 0;
    for (const { table, rows: tableRows } of data) {
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

    fs.renameSync(importFile, path.join(userDataDir, "import.done.json"));
    log(`Imported ${imported} rows from import.json (renamed to import.done.json).`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    // Leave import.json in place so the user can retry; surface the error.
    throw new Error("Data import failed: " + (e && e.message ? e.message : String(e)));
  } finally {
    await client.end();
  }
}

module.exports = { maybeImportData };
