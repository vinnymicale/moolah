/**
 * Backup round-trip check against a real, migrated schema.
 *
 * The unit suite mocks pg and asserts on SQL text, which means a renamed column
 * can't fail it - that's exactly how a broken export shipped once. This runs the
 * real exporter and importer over two throwaway databases built from the actual
 * migrations, then asserts every user, every role, and every capability override
 * survived the trip.
 *
 * Needs DATABASE_URL pointing at a Postgres the current role may CREATE DATABASE
 * on. Creates and drops its own databases; never touches the one in the URL.
 *
 * Usage:  npx tsx scripts/verify-backup-roundtrip.ts
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { exportAllData, importAllData } from "../src/lib/backup";

const SOURCE_DB = "backup_roundtrip_src";
const TARGET_DB = "backup_roundtrip_dst";

function urlFor(db: string): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

async function admin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function recreate(db: string) {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${db}"`);
  });
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: urlFor(db) },
  });
}

// One household, one member per role, with a granted and a denied override so a
// restore that drops the arrays is caught rather than silently passing.
const FIXTURE = `
INSERT INTO "User" (id, name, email, "passwordHash", "mustChangePassword")
VALUES
  ('u_own','Owner','owner@local','hash-own',false),
  ('u_adm','Admin','admin@local','hash-adm',false),
  ('u_mem','Member','member@local','hash-mem',true),
  ('u_vwr','Viewer','viewer@local','hash-vwr',false);

INSERT INTO "Household" (id, name, "ownerId", "plaidClientId", "plaidSecret", "plaidEnv")
VALUES ('hh_1','Test House','u_own','enc:pcid','enc:psec','production');

INSERT INTO "HouseholdMember" (id, "householdId", "userId", role, capabilities, "deniedCapabilities")
VALUES
  ('hm_own','hh_1','u_own','OWNER',  '{}', '{}'),
  ('hm_adm','hh_1','u_adm','ADMIN',  '{}', '{}'),
  ('hm_mem','hh_1','u_mem','MEMBER', '{MANAGE_RULES}', '{VIEW_RETIREMENT}'),
  ('hm_vwr','hh_1','u_vwr','VIEWER', '{}', '{VIEW_DEBT}');
`;

// What must come back byte-identical after the round-trip.
const CHECKS: { label: string; sql: string }[] = [
  {
    label: "users",
    sql: `SELECT id, name, email, "passwordHash", "mustChangePassword" FROM "User" ORDER BY id`,
  },
  {
    label: "household",
    sql: `SELECT id, name, "ownerId", "plaidClientId", "plaidSecret", "plaidEnv"
          FROM "Household" ORDER BY id`,
  },
  {
    label: "members",
    sql: `SELECT "userId", role, capabilities, "deniedCapabilities"
          FROM "HouseholdMember" ORDER BY "userId"`,
  },
];

async function snapshot(db: string): Promise<Record<string, string>> {
  const c = new Client({ connectionString: urlFor(db) });
  await c.connect();
  try {
    const out: Record<string, string> = {};
    for (const { label, sql } of CHECKS) {
      const { rows } = await c.query(sql);
      out[label] = JSON.stringify(rows);
    }
    return out;
  } finally {
    await c.end();
  }
}

async function main() {
  console.log(`Building ${SOURCE_DB} and ${TARGET_DB} from migrations...`);
  await recreate(SOURCE_DB);
  await recreate(TARGET_DB);

  const src = new Client({ connectionString: urlFor(SOURCE_DB) });
  await src.connect();
  try {
    await src.query(FIXTURE);
  } finally {
    await src.end();
  }

  const before = await snapshot(SOURCE_DB);

  console.log("Exporting...");
  const payload = await exportAllData(urlFor(SOURCE_DB));
  const rows = payload.tables.reduce((s, t) => s + t.rows.length, 0);
  console.log(`  ${rows} rows across ${payload.tables.length} tables`);

  // The export must carry every user, not a subset: a restore from a partial
  // file would come up with a household missing members.
  const users = payload.tables.find((t) => t.table === "User");
  if (!users || users.rows.length !== 4) {
    throw new Error(`export dropped users: expected 4, got ${users?.rows.length ?? 0}`);
  }
  const members = payload.tables.find((t) => t.table === "HouseholdMember");
  if (!members || members.rows.length !== 4) {
    throw new Error(`export dropped members: expected 4, got ${members?.rows.length ?? 0}`);
  }

  console.log("Restoring into a separate database...");
  const result = await importAllData(payload, urlFor(TARGET_DB), { force: true });
  console.log(`  imported ${result.imported} rows across ${result.tables} tables`);

  const after = await snapshot(TARGET_DB);

  let failed = false;
  for (const { label } of CHECKS) {
    if (before[label] === after[label]) {
      console.log(`  OK    ${label}`);
    } else {
      failed = true;
      console.error(`  FAIL  ${label}`);
      console.error(`    before: ${before[label]}`);
      console.error(`    after:  ${after[label]}`);
    }
  }

  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${SOURCE_DB}" WITH (FORCE)`);
    await c.query(`DROP DATABASE IF EXISTS "${TARGET_DB}" WITH (FORCE)`);
  });

  if (failed) throw new Error("backup round-trip lost data");
  console.log("\nBackup round-trip preserved every user, role, and override.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
