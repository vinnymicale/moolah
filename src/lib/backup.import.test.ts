// Tests for importAllData: the destructive restore behind the in-app "Restore
// from a backup" button and the db:restore CLI. We mock the pg Client and
// assert the SQL sequence (guard, transaction framing, FK disable, truncate,
// inserts) and the rollback-on-error contract. No real database is touched.

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

import { importAllData, type BackupPayload } from "./backup";

// All issued SQL strings, in call order, trimmed for matching.
function sqls(): string[] {
  return query.mock.calls.map((c) => (c[0] as string).trim());
}
function ran(fragment: string): boolean {
  return sqls().some((s) => s.includes(fragment));
}

// The schema columns the importer validates identifiers against. Covers every
// table/column the fixtures below reference.
const SCHEMA_ROWS = [
  { table_name: "User", column_name: "id" },
  { table_name: "User", column_name: "name" },
  { table_name: "Transaction", column_name: "id" },
  { table_name: "Transaction", column_name: "userId" },
  { table_name: "Transaction", column_name: "amount" },
];

// Make the User COUNT(*) return `userCount`; the schema lookup returns
// SCHEMA_ROWS; everything else resolves empty.
function wireCount(userCount: number) {
  query.mockImplementation((sql: string) => {
    if (sql.includes("information_schema.columns")) {
      return Promise.resolve({ rows: SCHEMA_ROWS });
    }
    if (sql.includes('COUNT(*)') && sql.includes('"User"')) {
      return Promise.resolve({ rows: [{ n: userCount }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const payload: BackupPayload = {
  app: "moolah",
  version: 1,
  exportedAt: "2026-06-14T00:00:00.000Z",
  tables: [
    { table: "User", rows: [{ id: "u1", name: "vinny" }] },
    { table: "Transaction", rows: [{ id: "t1", userId: "u1", amount: 5 }] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  connect.mockResolvedValue(undefined);
  end.mockResolvedValue(undefined);
});

describe("importAllData", () => {
  it("loads into an empty database without force", async () => {
    wireCount(0);

    const res = await importAllData(payload, "postgres://test");

    expect(res).toEqual({ imported: 2, tables: 2 });
    // Transaction framing and FK disable around the load.
    expect(ran("BEGIN")).toBe(true);
    expect(ran("SET session_replication_role = replica")).toBe(true);
    expect(ran("SET session_replication_role = DEFAULT")).toBe(true);
    expect(ran("COMMIT")).toBe(true);
    // Empty DB: no truncate.
    expect(ran("TRUNCATE")).toBe(false);
  });

  it("refuses a non-empty database unless force is set", async () => {
    wireCount(1);

    await expect(importAllData(payload, "postgres://test")).rejects.toThrow(/already has data/i);

    // Bailed before opening a transaction or inserting anything.
    expect(ran("BEGIN")).toBe(false);
    expect(ran("INSERT INTO")).toBe(false);
    expect(end).toHaveBeenCalledOnce();
  });

  it("truncates the backed-up tables first when forcing over existing data", async () => {
    wireCount(1);

    await importAllData(payload, "postgres://test", { force: true });

    const truncate = sqls().find((s) => s.startsWith("TRUNCATE"));
    expect(truncate).toBeDefined();
    expect(truncate).toContain('"User"');
    expect(truncate).toContain('"Transaction"');
    expect(truncate).toContain("RESTART IDENTITY CASCADE");
  });

  it("does not truncate when forcing into an already-empty database", async () => {
    wireCount(0);

    await importAllData(payload, "postgres://test", { force: true });

    expect(ran("TRUNCATE")).toBe(false);
  });

  it("inserts each row with ON CONFLICT DO NOTHING and bound params", async () => {
    wireCount(0);

    await importAllData(payload, "postgres://test");

    const insert = query.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes('INSERT INTO "Transaction"'),
    );
    expect(insert).toBeDefined();
    expect(insert![0]).toContain("ON CONFLICT DO NOTHING");
    expect(insert![0]).toContain('("id","userId","amount")');
    // Values are bound, never interpolated into the SQL text.
    expect(insert![1]).toEqual(["t1", "u1", 5]);
  });

  it("skips rows that have no columns", async () => {
    wireCount(0);

    const res = await importAllData(
      { ...payload, tables: [{ table: "User", rows: [{}, { id: "u1" }] }] },
      "postgres://test",
    );

    // Only the row with columns is counted/inserted.
    expect(res.imported).toBe(1);
    const inserts = sqls().filter((s) => s.startsWith('INSERT INTO "User"'));
    expect(inserts).toHaveLength(1);
  });

  it("rolls back and rethrows when an insert fails", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("information_schema.columns")) return Promise.resolve({ rows: SCHEMA_ROWS });
      if (sql.includes("COUNT(*)")) return Promise.resolve({ rows: [{ n: 0 }] });
      if (sql.startsWith("INSERT INTO")) return Promise.reject(new Error("constraint blew up"));
      return Promise.resolve({ rows: [] });
    });

    await expect(importAllData(payload, "postgres://test")).rejects.toThrow("constraint blew up");

    expect(ran("ROLLBACK")).toBe(true);
    expect(ran("COMMIT")).toBe(false);
    expect(end).toHaveBeenCalledOnce();
  });

  it("rejects a backup that references a table not in the schema", async () => {
    wireCount(0);

    await expect(
      importAllData({ ...payload, tables: [{ table: "evil; DROP TABLE", rows: [{ id: "x" }] }] }, "postgres://test"),
    ).rejects.toThrow(/unknown table/i);

    // Rejected before any insert ran.
    expect(ran("INSERT INTO")).toBe(false);
  });

  it("rejects a backup that references a column not in the schema", async () => {
    wireCount(0);

    await expect(
      importAllData(
        { ...payload, tables: [{ table: "User", rows: [{ id: "u1", "evil\" --": 1 }] }] },
        "postgres://test",
      ),
    ).rejects.toThrow(/unknown column/i);

    expect(ran('INSERT INTO "User"')).toBe(false);
  });

  it("accepts a bare table array as well as a full payload", async () => {
    wireCount(0);

    const res = await importAllData(payload.tables, "postgres://test");

    expect(res).toEqual({ imported: 2, tables: 2 });
  });
});
