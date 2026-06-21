// Action-layer tests for accounts.ts. These cover the demo-mode short-circuit,
// ownership checks, the asset/liability derivation (isAsset + debt-field
// nulling), the debt-terms guard against asset accounts, and the snapshot
// create/setCurrent behavior - by stubbing prisma, session, and cache.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    accountSnapshot: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import {
  createAccountAction,
  updateDebtTermsAction,
  deleteAccountAction,
  addSnapshotAction,
  deleteSnapshotAction,
} from "./accounts";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const account = vi.mocked(prisma.financialAccount);
const snapshot = vi.mocked(prisma.accountSnapshot);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("createAccountAction is a no-op success in demo mode", async () => {
    const result = await createAccountAction({ name: "Checking", type: "CHECKING", currentBalance: 100 });
    expect(result).toEqual({ ok: true });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(account.create).not.toHaveBeenCalled();
  });

  it("deleteAccountAction is a no-op success in demo mode", async () => {
    expect(await deleteAccountAction("a1")).toEqual({ ok: true });
    expect(account.delete).not.toHaveBeenCalled();
  });
});

describe("createAccountAction asset/liability derivation", () => {
  it("marks a checking account as an asset with debt fields nulled", async () => {
    await createAccountAction({
      name: "Checking",
      type: "CHECKING",
      currentBalance: 500,
      interestRate: 5,
      minimumPayment: 10,
    });
    const data = account.create.mock.calls[0][0].data;
    expect(data.isAsset).toBe(true);
    // Debt fields are forced null for assets even when supplied.
    expect(data.interestRate).toBeNull();
    expect(data.minimumPayment).toBeNull();
    expect(data.includeInDebtPlanner).toBe(true);
  });

  it("marks a credit card as a liability and keeps its debt terms", async () => {
    await createAccountAction({
      name: "Visa",
      type: "CREDIT_CARD",
      currentBalance: 1200,
      interestRate: 19.99,
      minimumPayment: 35,
    });
    const data = account.create.mock.calls[0][0].data;
    expect(data.isAsset).toBe(false);
    expect(data.interestRate).toBe(19.99);
    expect(data.minimumPayment).toBe(35);
  });

  it("rejects an interest rate above 100", async () => {
    const result = await createAccountAction({
      name: "Visa",
      type: "CREDIT_CARD",
      currentBalance: 100,
      interestRate: 150,
    });
    expect(result.ok).toBe(false);
    expect(account.create).not.toHaveBeenCalled();
  });
});

describe("updateDebtTermsAction", () => {
  it("rejects updating terms on an asset account", async () => {
    account.findFirst.mockResolvedValue({ id: "a1", type: "CHECKING" } as never);
    const result = await updateDebtTermsAction("a1", { interestRate: 5, minimumPayment: 10 });
    expect(result).toEqual({ ok: false, error: "Only debt accounts have payoff terms." });
    expect(account.update).not.toHaveBeenCalled();
  });

  it("updates terms on a liability account", async () => {
    account.findFirst.mockResolvedValue({ id: "a1", type: "CREDIT_CARD" } as never);
    const result = await updateDebtTermsAction("a1", { interestRate: 18.5, minimumPayment: 40 });
    expect(result).toEqual({ ok: true });
    expect(account.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { interestRate: 18.5, minimumPayment: 40 },
    });
  });

  it("errors when the account is not owned by the user", async () => {
    account.findFirst.mockResolvedValue(null);
    const result = await updateDebtTermsAction("a1", { interestRate: 5, minimumPayment: 10 });
    expect(result).toEqual({ ok: false, error: "Account not found" });
  });
});

describe("addSnapshotAction", () => {
  beforeEach(() => {
    account.findFirst.mockResolvedValue({ id: "a1", type: "SAVINGS" } as never);
  });

  it("creates a snapshot and updates the current balance by default", async () => {
    const result = await addSnapshotAction({ accountId: "a1", balance: 900, date: "2026-06-01" });
    expect(result).toEqual({ ok: true });
    expect(snapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: "a1", balance: 900, note: null }),
    });
    expect(account.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { currentBalance: 900 },
    });
  });

  it("does not touch the current balance when setCurrent is false", async () => {
    await addSnapshotAction({ accountId: "a1", balance: 900, date: "2026-06-01", setCurrent: false });
    expect(snapshot.create).toHaveBeenCalled();
    expect(account.update).not.toHaveBeenCalled();
  });

  it("errors when the account is not owned by the user", async () => {
    account.findFirst.mockResolvedValue(null);
    const result = await addSnapshotAction({ accountId: "a1", balance: 900, date: "2026-06-01" });
    expect(result).toEqual({ ok: false, error: "Account not found" });
    expect(snapshot.create).not.toHaveBeenCalled();
  });
});

describe("deleteSnapshotAction", () => {
  it("scopes ownership through the account relation", async () => {
    snapshot.findFirst.mockResolvedValue({ id: "s1" } as never);
    const result = await deleteSnapshotAction("s1");
    expect(result).toEqual({ ok: true });
    expect(snapshot.findFirst).toHaveBeenCalledWith({ where: { id: "s1", account: { userId: "u1" } } });
    expect(snapshot.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("errors when the snapshot does not belong to the user", async () => {
    snapshot.findFirst.mockResolvedValue(null);
    const result = await deleteSnapshotAction("s1");
    expect(result).toEqual({ ok: false, error: "Snapshot not found" });
    expect(snapshot.delete).not.toHaveBeenCalled();
  });
});
