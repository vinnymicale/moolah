// Guards the backfill in prisma/migrations/*_scope_data_to_household. That
// migration is the one-way door for existing installs: it renames every
// userId column to householdId and rewrites the values to 'hh_' || userId. A
// table the schema scopes to a household but the migration forgot would keep
// user ids in a householdId column and silently leak data across households.
//
// These assertions read the migration SQL and the schema rather than a live
// database - the unit suite has no Postgres, and the backfill is fully
// deterministic, so its invariants are static properties of the SQL.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");

function migrationDir(suffix: string): string {
  const dir = readdirSync(MIGRATIONS).find((d) => d.endsWith(suffix));
  if (!dir) throw new Error(`no migration ending in ${suffix}`);
  return dir;
}

function migrationSql(suffix: string): string {
  return readFileSync(join(MIGRATIONS, migrationDir(suffix), "migration.sql"), "utf8");
}

const scope = migrationSql("_scope_data_to_household");
const households = migrationSql("_add_households");
const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

// Models carrying a householdId field, read from the schema so a new
// household-scoped model fails this suite until the migration covers it.
function householdScopedModels(): string[] {
  const found: string[] = [];
  for (const block of schema.split(/\nmodel /).slice(1)) {
    const name = block.slice(0, block.indexOf(" "));
    const body = block.slice(0, block.indexOf("\n}"));
    if (/^\s+householdId\s+String/m.test(body)) found.push(name);
  }
  return found;
}

describe("household backfill", () => {
  it("creates one household per user, owned by that user", () => {
    expect(scope).toMatch(/INSERT INTO "Household"[\s\S]+FROM "User";/);
    expect(scope).toMatch(/'hh_' \|\| "id"/);
  });

  it("makes every user the OWNER member of their household", () => {
    expect(scope).toMatch(
      /INSERT INTO "HouseholdMember"[\s\S]+'hm_' \|\| "id", 'hh_' \|\| "id", "id", 'OWNER'[\s\S]+FROM "User";/,
    );
  });

  it("renames and rewrites userId for every household-scoped model", () => {
    // HouseholdMember and AuditLog are new tables, not renamed ones; the child
    // tables inherit scope through a parent relation and have no column here.
    const exempt = new Set(["HouseholdMember", "AuditLog"]);
    const missing = householdScopedModels()
      .filter((m) => !exempt.has(m))
      .filter(
        (m) =>
          !scope.includes(`ALTER TABLE "${m}" RENAME COLUMN "userId" TO "householdId";`) ||
          !scope.includes(`UPDATE "${m}" SET "householdId" = 'hh_' || "householdId";`),
      );
    expect(missing).toEqual([]);
  });

  it("rewrites values for every column it renames", () => {
    const renamed = [...scope.matchAll(/ALTER TABLE "(\w+)" RENAME COLUMN "userId" TO "householdId";/g)].map(
      (m) => m[1],
    );
    expect(renamed.length).toBeGreaterThan(10);
    for (const table of renamed) {
      expect(scope).toContain(`UPDATE "${table}" SET "householdId" = 'hh_' || "householdId";`);
    }
  });

  it("points every rewritten column at Household with a cascading delete", () => {
    const renamed = [...scope.matchAll(/ALTER TABLE "(\w+)" RENAME COLUMN "userId" TO "householdId";/g)].map(
      (m) => m[1],
    );
    for (const table of renamed) {
      expect(scope).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_householdId_fkey" FOREIGN KEY \\("householdId"\\) REFERENCES "Household"\\("id"\\) ON DELETE CASCADE`,
        ),
      );
    }
  });

  it("holds a user to a single household", () => {
    // The schema's @@unique([userId]) is what lets getHouseholdContext do a
    // findUnique by userId; losing it would silently return an arbitrary row.
    expect(households).toContain(
      'CREATE UNIQUE INDEX "HouseholdMember_userId_key" ON "HouseholdMember"("userId")',
    );
    expect(schema).toMatch(/@@unique\(\[userId\]\)/);
  });

  it("moves credentials to Household and drops them from User", () => {
    for (const col of [
      "aiProvider",
      "aiApiKey",
      "aiModel",
      "plaidClientId",
      "plaidSecret",
      "plaidEnv",
      "apiTokenSelector",
      "apiTokenVerifierHash",
    ]) {
      expect(scope).toContain(`"${col}"`);
      expect(scope).toMatch(new RegExp(`DROP COLUMN "${col}"`));
    }
  });

  it("backfills attribution from the household owner", () => {
    for (const table of ["Transaction", "Rule", "Budget", "SavingsGoal", "RecurringRule"]) {
      expect(scope).toMatch(
        new RegExp(`ALTER TABLE "${table}"\\s+ADD COLUMN "createdById" TEXT;`),
      );
      expect(scope).toMatch(
        new RegExp(`UPDATE "${table}"\\s+t SET "createdById" = h\\."ownerId" FROM "Household" h`),
      );
    }
  });

  // migrate deploy applies migrations in directory-name order, not creation
  // order, so the backfill below is only safe if the DDL sorts ahead of it. A
  // dev database migrated incrementally hides this; a container upgrade does
  // not, and fails with relation "Household" does not exist.
  it("creates the household tables in a migration that sorts before the backfill", () => {
    expect(migrationDir("_add_households") < migrationDir("_scope_data_to_household")).toBe(true);
  });

  it("keeps attribution nullable so deleting a user does not delete their rows", () => {
    const attributions = [...scope.matchAll(/ADD CONSTRAINT "\w+_createdById_fkey"[^;]+/g)].map((m) => m[0]);
    expect(attributions.length).toBe(5);
    for (const fk of attributions) expect(fk).toContain("ON DELETE SET NULL");
  });
});
