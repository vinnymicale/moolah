// Tests for exportAllData: the backup download has to carry the whole database,
// because a restore has to land on another machine with every member's login and
// the household's Plaid credentials intact. A dump that quietly scoped itself to
// one user would restore into a household missing its other members, so what's
// pinned here is that nothing gets filtered out except Prisma's own bookkeeping.
// We mock the pg Client and inspect the SQL it's asked to run.

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

import { exportAllData, encodeBackupRow, decodeBackupValue } from "./index";

// The pg_tables lookup comes first, then one SELECT per table. We drive
// responses by matching on the SQL text rather than on call order.
function wireSchema(tables: string[], rowsByTable: Record<string, Record<string, unknown>[]> = {}) {
  query.mockImplementation((sql: string) => {
    if (sql.includes("FROM pg_tables")) {
      return Promise.resolve({ rows: tables.map((t) => ({ tablename: t })) });
    }
    const table = sql.match(/FROM "([^"]+)"/)?.[1] ?? "";
    return Promise.resolve({ rows: rowsByTable[table] ?? [] });
  });
}

function dumpedTables() {
  return query.mock.calls
    .map((c) => c[0] as string)
    .filter((sql) => /^SELECT \* FROM/.test(sql))
    .map((sql) => sql.match(/FROM "([^"]+)"/)?.[1] ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  connect.mockResolvedValue(undefined);
  end.mockResolvedValue(undefined);
});

describe("exportAllData", () => {
  it("dumps every table whole, with no WHERE clause to scope it to one user", async () => {
    wireSchema(["Account", "Transaction", "User"]);
    await exportAllData("postgresql://u:p@localhost:5432/db");

    const selects = query.mock.calls
      .map((c) => c[0] as string)
      .filter((sql) => /^SELECT \* FROM/.test(sql));
    expect(selects).toHaveLength(3);
    for (const sql of selects) {
      expect(sql).not.toMatch(/WHERE/i);
    }
    // No bound parameters either - a scoped dump would have to pass a user id.
    for (const call of query.mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });

  it("carries every household table, including members and their roles", async () => {
    wireSchema(["Household", "HouseholdMember", "Transaction", "User"], {
      User: [{ id: "u_own" }, { id: "u_mem" }],
      HouseholdMember: [
        { id: "hm_own", userId: "u_own", role: "OWNER" },
        { id: "hm_mem", userId: "u_mem", role: "MEMBER" },
      ],
    });
    const payload = await exportAllData("postgresql://u:p@localhost:5432/db");

    expect(dumpedTables()).toEqual(["Household", "HouseholdMember", "Transaction", "User"]);
    const members = payload.tables.find((t) => t.table === "HouseholdMember");
    expect(members?.rows).toHaveLength(2);
    expect(members?.rows.map((r) => r.role)).toEqual(["OWNER", "MEMBER"]);
    expect(payload.tables.find((t) => t.table === "User")?.rows).toHaveLength(2);
  });

  it("skips Prisma's migration bookkeeping table", async () => {
    wireSchema(["Transaction", "_prisma_migrations"]);
    const payload = await exportAllData("postgresql://u:p@localhost:5432/db");

    expect(dumpedTables()).toEqual(["Transaction"]);
    expect(payload.tables.map((t) => t.table)).toEqual(["Transaction"]);
  });

  it("stamps the payload envelope and closes the connection", async () => {
    wireSchema(["Transaction"], { Transaction: [{ id: "t1" }] });
    const payload = await exportAllData("postgresql://u:p@localhost:5432/db");

    expect(payload.app).toBe("moolah");
    expect(payload.version).toBe(1);
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false);
    expect(payload.tables).toEqual([{ table: "Transaction", rows: [{ id: "t1" }] }]);
    expect(end).toHaveBeenCalled();
  });

  it("closes the connection even when a table read fails", async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes("FROM pg_tables")) {
        return Promise.resolve({ rows: [{ tablename: "Transaction" }] });
      }
      return Promise.reject(new Error("permission denied"));
    });

    await expect(exportAllData("postgresql://u:p@localhost:5432/db")).rejects.toThrow(
      "permission denied",
    );
    expect(end).toHaveBeenCalled();
  });
});

describe("bytea round-trip", () => {
  it("encodes Buffer values to a base64 marker and decodes them back", () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const row = { id: "a1", data: buf, size: 4, createdAt: new Date("2026-07-18T00:00:00Z") };
    const encoded = encodeBackupRow(row);
    expect(Buffer.isBuffer(encoded.data)).toBe(false);

    // Survive the JSON round-trip the backup file goes through.
    const revived = JSON.parse(JSON.stringify(encoded)) as Record<string, unknown>;
    const decoded = decodeBackupValue(revived.data);
    expect(Buffer.isBuffer(decoded)).toBe(true);
    expect((decoded as Buffer).equals(buf)).toBe(true);
  });

  it("passes non-Buffer values through unchanged", () => {
    expect(decodeBackupValue("plain")).toBe("plain");
    expect(decodeBackupValue(42)).toBe(42);
    expect(decodeBackupValue(null)).toBeNull();
    const obj = { a: 1 };
    expect(decodeBackupValue(obj)).toBe(obj);
    expect(encodeBackupRow({ x: "y" })).toEqual({ x: "y" });
  });
});
