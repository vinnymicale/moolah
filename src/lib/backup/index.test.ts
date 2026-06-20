// Tests for exportUserData's scoping: every table dumped must be constrained to
// the one user, and any table with no path back to a user must be skipped
// (never dumped whole). We mock the pg Client and inspect the SQL it's asked to
// run plus the bound $1 parameter.

import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
const connect = vi.fn();
const end = vi.fn();

vi.mock("pg", () => ({
  Client: class {
    connect = connect;
    query = query;
    end = end;
  },
}));

import { exportUserData } from "./index";

// pg_tables and information_schema lookups come first, in source order. The
// per-table SELECTs follow. We drive responses by matching on the SQL text so
// the test doesn't depend on call ordering of the data queries.
function wireSchema(opts: {
  tables: string[];
  userIdTables: string[];
  rowsByTable?: Record<string, Record<string, unknown>[]>;
}) {
  query.mockImplementation((sql: string) => {
    if (sql.includes("FROM pg_tables")) {
      return Promise.resolve({ rows: opts.tables.map((t) => ({ tablename: t })) });
    }
    if (sql.includes("information_schema.columns")) {
      return Promise.resolve({ rows: opts.userIdTables.map((t) => ({ table_name: t })) });
    }
    // A data SELECT for one table.
    const m = sql.match(/FROM "([^"]+)"/);
    const table = m?.[1] ?? "";
    return Promise.resolve({ rows: opts.rowsByTable?.[table] ?? [] });
  });
}

// Pull out just the data SELECTs (those with a WHERE userId binding), keyed by table.
function dataSelects() {
  return query.mock.calls
    .map((c) => c[0] as string)
    .filter((sql) => /^SELECT \* FROM/.test(sql))
    .map((sql) => ({ sql, table: sql.match(/FROM "([^"]+)"/)?.[1] ?? "" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  connect.mockResolvedValue(undefined);
  end.mockResolvedValue(undefined);
});

describe("exportUserData", () => {
  it("scopes a userId-bearing table by its userId column", async () => {
    wireSchema({ tables: ["Transaction"], userIdTables: ["Transaction"] });

    await exportUserData("u1", "postgres://test");

    const sel = dataSelects();
    expect(sel).toHaveLength(1);
    expect(sel[0].sql).toContain('"userId" = $1');
    // The bound parameter is the user id, never interpolated into the string.
    const dataCall = query.mock.calls.find((c) => /^SELECT \* FROM "Transaction"/.test(c[0] as string));
    expect(dataCall?.[1]).toEqual(["u1"]);
  });

  it("scopes the User table by id, not userId", async () => {
    wireSchema({ tables: ["User"], userIdTables: [] });

    await exportUserData("u1", "postgres://test");

    const sel = dataSelects();
    expect(sel[0].sql).toContain("WHERE id = $1");
    expect(sel[0].sql).not.toContain("userId");
  });

  it("scopes child tables through their user-owned parent subquery", async () => {
    wireSchema({
      tables: ["AccountSnapshot", "PlaidLinkedAccount"],
      userIdTables: [],
    });

    await exportUserData("u1", "postgres://test");

    const byTable = Object.fromEntries(dataSelects().map((s) => [s.table, s.sql]));
    expect(byTable.AccountSnapshot).toContain('"accountId" IN (SELECT id FROM "FinancialAccount" WHERE "userId" = $1)');
    expect(byTable.PlaidLinkedAccount).toContain('"plaidItemId" IN (SELECT id FROM "PlaidItem" WHERE "userId" = $1)');
  });

  it("skips tables with no relationship to a user", async () => {
    wireSchema({
      tables: ["Transaction", "VerificationToken"],
      userIdTables: ["Transaction"],
    });

    const payload = await exportUserData("u1", "postgres://test");

    // VerificationToken has no userId, isn't a known child - it must not be queried or included.
    const tablesQueried = dataSelects().map((s) => s.table);
    expect(tablesQueried).toContain("Transaction");
    expect(tablesQueried).not.toContain("VerificationToken");
    expect(payload.tables.map((t) => t.table)).not.toContain("VerificationToken");
  });

  it("skips Prisma's migration bookkeeping table", async () => {
    wireSchema({
      tables: ["_prisma_migrations", "Transaction"],
      userIdTables: ["Transaction"],
    });

    await exportUserData("u1", "postgres://test");

    expect(dataSelects().map((s) => s.table)).not.toContain("_prisma_migrations");
  });

  it("carries the matched rows into the payload and closes the connection", async () => {
    wireSchema({
      tables: ["Transaction"],
      userIdTables: ["Transaction"],
      rowsByTable: { Transaction: [{ id: "t1", userId: "u1" }] },
    });

    const payload = await exportUserData("u1", "postgres://test");

    expect(payload.app).toBe("moolah");
    expect(payload.version).toBe(1);
    expect(payload.tables).toEqual([{ table: "Transaction", rows: [{ id: "t1", userId: "u1" }] }]);
    expect(end).toHaveBeenCalledOnce();
  });
});
