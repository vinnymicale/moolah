// Response-shape contract tests for the /api/v1 GET handlers. Auth is mocked to
// always pass (the gate itself is covered in _auth.test.ts); the underlying
// query layer is mocked so these assert only the JSON envelope each route
// promises external consumers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("./_auth", async (orig) => {
  const actual = await orig<typeof import("./_auth")>();
  return { ...actual, requireApiUser: vi.fn(async () => ({ ok: true, userId: "u1" })) };
});
vi.mock("@/lib/queries", () => ({
  getNetWorth: vi.fn(),
  getSafeToTransfer: vi.fn(),
  getBudgetMonth: vi.fn(),
  getAccounts: vi.fn(),
}));
vi.mock("@/lib/calendar", () => ({ getUpcoming: vi.fn() }));
vi.mock("@/lib/user-tz", () => ({ todayInZone: vi.fn(() => "2026-06-13") }));

import { requireApiUser } from "./_auth";
import { getNetWorth, getSafeToTransfer, getBudgetMonth, getAccounts } from "@/lib/queries";
import { getUpcoming } from "@/lib/calendar";

const auth = vi.mocked(requireApiUser);
const netWorth = vi.mocked(getNetWorth);
const safe = vi.mocked(getSafeToTransfer);
const budget = vi.mocked(getBudgetMonth);
const accounts = vi.mocked(getAccounts);
const upcoming = vi.mocked(getUpcoming);

function req(url = "http://localhost/api/v1/x", headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ ok: true, userId: "u1" });
});

describe("GET /api/v1/net-worth", () => {
  it("returns assets/liabilities/net and mapped accounts", async () => {
    netWorth.mockResolvedValue({
      assets: 1000,
      liabilities: 250,
      net: 750,
      accounts: [
        {
          id: "a1",
          name: "Checking",
          type: "CHECKING",
          currentBalance: 1000,
          isAsset: true,
          includeInNetWorth: true,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getNetWorth>>);

    const { GET } = await import("./net-worth/route");
    const body = await (await GET(req())).json();

    expect(body).toEqual({
      assets: 1000,
      liabilities: 250,
      net: 750,
      accounts: [
        { id: "a1", name: "Checking", type: "CHECKING", balance: 1000, isAsset: true, includeInNetWorth: true },
      ],
    });
  });
});

describe("GET /api/v1/accounts", () => {
  it("maps accounts to the public shape", async () => {
    accounts.mockResolvedValue([
      {
        id: "a1",
        name: "Visa",
        type: "CREDIT_CARD",
        institution: "Bank",
        currentBalance: -200,
        isAsset: false,
        creditLimit: 5000,
        nextPaymentDueDate: "2026-07-01",
      },
    ] as unknown as Awaited<ReturnType<typeof getAccounts>>);

    const { GET } = await import("./accounts/route");
    const body = await (await GET(req())).json();

    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toEqual({
      id: "a1",
      name: "Visa",
      type: "CREDIT_CARD",
      institution: "Bank",
      balance: -200,
      isAsset: false,
      creditLimit: 5000,
      nextPaymentDueDate: "2026-07-01",
    });
  });
});

describe("GET /api/v1/budget", () => {
  it("totals limit/spent and exposes per-category remaining", async () => {
    budget.mockResolvedValue([
      { categoryId: "c1", name: "Food", limit: 400, actual: 150 },
      { categoryId: "c2", name: "Fuel", limit: 100, actual: 120 },
    ] as unknown as Awaited<ReturnType<typeof getBudgetMonth>>);

    const { GET } = await import("./budget/route");
    const body = await (await GET(req("http://localhost/api/v1/budget?month=2026-06"))).json();

    expect(body.month).toBe("2026-06-01");
    expect(body.total).toEqual({ limit: 500, spent: 270, remaining: 230 });
    expect(body.categories).toEqual([
      { categoryId: "c1", name: "Food", limit: 400, spent: 150, remaining: 250 },
      { categoryId: "c2", name: "Fuel", limit: 100, spent: 120, remaining: -20 },
    ]);
  });
});

describe("GET /api/v1/upcoming", () => {
  it("clamps days and maps items", async () => {
    upcoming.mockResolvedValue([
      { date: "2026-06-15", description: "Rent", amount: -1200, type: "EXPENSE", recurring: true },
    ] as unknown as Awaited<ReturnType<typeof getUpcoming>>);

    const { GET } = await import("./upcoming/route");
    const res = await GET(req("http://localhost/api/v1/upcoming?days=500"));
    const body = await res.json();

    expect(body.days).toBe(90); // clamped from 500
    expect(body.asOf).toBe("2026-06-13");
    expect(body.items).toEqual([
      { date: "2026-06-15", description: "Rent", amount: -1200, type: "EXPENSE", recurring: true },
    ]);
    // getUpcoming was asked for the clamped window.
    expect(upcoming).toHaveBeenCalledWith("u1", "2026-06-13", 90);
  });
});

describe("GET /api/v1/summary", () => {
  it("assembles net worth, safe-to-transfer, budget, and upcoming", async () => {
    netWorth.mockResolvedValue({ assets: 1000, liabilities: 200, net: 800 } as unknown as Awaited<
      ReturnType<typeof getNetWorth>
    >);
    safe.mockResolvedValue({ show: true, safeAmount: 350 } as unknown as Awaited<ReturnType<typeof getSafeToTransfer>>);
    budget.mockResolvedValue([
      { categoryId: "c1", name: "Food", limit: 400, actual: 150 },
    ] as unknown as Awaited<ReturnType<typeof getBudgetMonth>>);
    upcoming.mockResolvedValue([
      { date: "2026-06-20", description: "Paycheck", amount: 2000, type: "INCOME", recurring: true },
    ] as unknown as Awaited<ReturnType<typeof getUpcoming>>);

    const { GET } = await import("./summary/route");
    const body = await (await GET(req())).json();

    expect(body.asOf).toBe("2026-06-13");
    expect(body.netWorth).toEqual({ assets: 1000, liabilities: 200, net: 800 });
    expect(body.safeToTransfer).toBe(350);
    expect(body.budget).toEqual({ month: "2026-06-01", limit: 400, spent: 150, remaining: 250 });
    expect(body.upcoming).toEqual([
      { date: "2026-06-20", description: "Paycheck", amount: 2000, type: "INCOME", recurring: true },
    ]);
  });

  it("reports safeToTransfer as 0 when the figure is hidden", async () => {
    netWorth.mockResolvedValue({ assets: 0, liabilities: 0, net: 0 } as unknown as Awaited<
      ReturnType<typeof getNetWorth>
    >);
    safe.mockResolvedValue({ show: false, safeAmount: 999 } as unknown as Awaited<ReturnType<typeof getSafeToTransfer>>);
    budget.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getBudgetMonth>>);
    upcoming.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getUpcoming>>);

    const { GET } = await import("./summary/route");
    const body = await (await GET(req())).json();
    expect(body.safeToTransfer).toBe(0);
  });
});
