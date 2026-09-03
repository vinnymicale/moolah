// getRecurringRules picks the version in force today and reports history newest
// first, while startDate deliberately comes from the oldest version rather than
// the active one. getRecurringSuggestions is mostly a funnel into
// detectRecurringCandidates, so what matters is the window it queries and the
// description list it uses to suppress already-covered charges.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recurringRule: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getRecurringRules, getRecurringSuggestions } from "./recurring";

type MockedDelegates = Record<string, Record<string, Mock>>;
const db = prisma as unknown as MockedDelegates;

/** One rule version; only the fields the flattener reads need supplying. */
function version(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "v1",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    type: "EXPENSE",
    amount: 10,
    note: null,
    accountId: "acct1",
    categoryId: "cat1",
    frequency: "MONTHLY",
    interval: 1,
    dayOfMonth: 1,
    weekday: null,
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: null,
    ...over,
  };
}

function rule(versions: ReturnType<typeof version>[], over: Partial<Record<string, unknown>> = {}) {
  return { id: "r1", description: "Netflix", versions, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.findMany.mockResolvedValue([]);
  db.recurringRule.findMany.mockResolvedValue([]);
});

describe("getRecurringRules", () => {
  it("hides archived rules unless asked for them", async () => {
    await getRecurringRules("u1");
    expect(db.recurringRule.findMany.mock.calls[0][0].where).toEqual({ userId: "u1", archived: false });

    await getRecurringRules("u1", true);
    expect(db.recurringRule.findMany.mock.calls[1][0].where).toEqual({ userId: "u1" });
  });

  it("flattens to the version in force on the given day", async () => {
    db.recurringRule.findMany.mockResolvedValue([
      rule([
        version({ id: "v1", amount: 10, effectiveFrom: new Date("2026-01-01T00:00:00Z") }),
        version({ id: "v2", amount: 18, effectiveFrom: new Date("2026-06-01T00:00:00Z") }),
      ]),
    ]);

    const [before] = await getRecurringRules("u1", false, "2026-05-31");
    expect(before.amount).toBe(10);

    const [after] = await getRecurringRules("u1", false, "2026-07-15");
    expect(after.amount).toBe(18);
  });

  it("takes startDate from the oldest version, not the active one", async () => {
    db.recurringRule.findMany.mockResolvedValue([
      rule([
        version({ id: "v1", startDate: new Date("2024-03-09T00:00:00Z") }),
        version({
          id: "v2",
          effectiveFrom: new Date("2026-06-01T00:00:00Z"),
          startDate: new Date("2026-06-01T00:00:00Z"),
        }),
      ]),
    ]);

    const [r] = await getRecurringRules("u1", false, "2026-07-15");
    expect(r.startDate).toBe("2024-03-09");
  });

  it("lists version history newest first without mutating the source order", async () => {
    const versions = [
      version({ id: "v1", effectiveFrom: new Date("2026-01-01T00:00:00Z") }),
      version({ id: "v2", effectiveFrom: new Date("2026-06-01T00:00:00Z") }),
      version({ id: "v3", effectiveFrom: new Date("2026-09-01T00:00:00Z") }),
    ];
    db.recurringRule.findMany.mockResolvedValue([rule(versions)]);

    const [r] = await getRecurringRules("u1", false, "2026-07-15");
    expect(r.versions.map((v) => v.id)).toEqual(["v3", "v2", "v1"]);
    expect(versions.map((v) => v.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("emits ISO days for every date and null for an open-ended run", async () => {
    db.recurringRule.findMany.mockResolvedValue([
      rule([version({ endDate: null, startDate: new Date("2026-02-14T00:00:00Z") })]),
    ]);

    const [r] = await getRecurringRules("u1", false, "2026-07-15");
    expect(r.startDate).toBe("2026-02-14");
    expect(r.endDate).toBeNull();
    expect(r.versions[0].effectiveFrom).toBe("2026-01-01");
  });

  it("carries an end date through when the active version has one", async () => {
    db.recurringRule.findMany.mockResolvedValue([
      rule([version({ endDate: new Date("2026-12-31T00:00:00Z") })]),
    ]);

    const [r] = await getRecurringRules("u1", false, "2026-07-15");
    expect(r.endDate).toBe("2026-12-31");
  });
});

describe("getRecurringSuggestions", () => {
  it("scans back eight whole months from the given day", async () => {
    await getRecurringSuggestions("u1", "2026-09-03");

    const where = db.transaction.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe("u1");
    expect(where.deletedAt).toBeNull();
    expect((where.date.gte as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("suppresses charges already covered by a rule's own description", async () => {
    db.recurringRule.findMany.mockResolvedValue([{ description: "NETFLIX.COM" }]);
    db.transaction.findMany.mockResolvedValue(
      ["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"].map((d) => ({
        date: new Date(`${d}T00:00:00Z`),
        description: "NETFLIX.COM",
        amount: 15.99,
        type: "EXPENSE",
        categoryId: "cat1",
        accountId: "acct1",
        recurringRuleId: null,
      })),
    );

    const out = await getRecurringSuggestions("u1", "2026-07-01");
    expect(out.find((s) => s.description.toLowerCase().includes("netflix"))).toBeUndefined();
  });

  it("suppresses a charge whose linked transactions differ from the rule's name", async () => {
    // The rule is named "Gym Membership" but the bank string is "LA FITNESS",
    // so only the linked transaction's own description can suppress it.
    db.recurringRule.findMany.mockResolvedValue([{ description: "Gym Membership" }]);
    db.transaction.findMany.mockResolvedValue([
      {
        date: new Date("2026-02-05T00:00:00Z"),
        description: "LA FITNESS",
        amount: 39.99,
        type: "EXPENSE",
        categoryId: "cat1",
        accountId: "acct1",
        recurringRuleId: "r1",
      },
      ...["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"].map((d) => ({
        date: new Date(`${d}T00:00:00Z`),
        description: "LA FITNESS",
        amount: 39.99,
        type: "EXPENSE",
        categoryId: "cat1",
        accountId: "acct1",
        recurringRuleId: null,
      })),
    ]);

    const out = await getRecurringSuggestions("u1", "2026-07-01");
    expect(out.find((s) => s.description.toLowerCase().includes("fitness"))).toBeUndefined();
  });

  it("surfaces a regular charge no rule covers", async () => {
    db.transaction.findMany.mockResolvedValue(
      ["2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"].map((d) => ({
        date: new Date(`${d}T00:00:00Z`),
        description: "SPOTIFY USA",
        amount: 11.99,
        type: "EXPENSE",
        categoryId: "cat1",
        accountId: "acct1",
        recurringRuleId: null,
      })),
    );

    const out = await getRecurringSuggestions("u1", "2026-07-01");
    expect(out.map((s) => s.description)).toContain("SPOTIFY USA");
  });
});
