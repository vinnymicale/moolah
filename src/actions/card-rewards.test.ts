import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/household", () => ({ requireCapability: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findFirst: vi.fn() },
    cardRewardProfile: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    cardCapProgress: { upsert: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));

import {
  createRewardProfileAction,
  updateRewardProfileAction,
  deleteRewardProfileAction,
  setCapProgressAction,
  setRotatingActivatedAction,
} from "./card-rewards";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/household";
import { findCatalogCard } from "@/lib/card-rewards/catalog";
import type { RewardProfileInput } from "@/lib/card-rewards/types";

const householdMock = vi.mocked(requireCapability);
const account = vi.mocked(prisma.financialAccount);
const profile = vi.mocked(prisma.cardRewardProfile);
const progress = vi.mocked(prisma.cardCapProgress);

const storedProfile = {
  id: "p1",
  householdId: "h1",
  financialAccount: { name: "Freedom Flex" },
  rules: [
    { category: "DINING", rate: 3 },
    { category: "GROCERIES", rate: 6, cap: { amount: 6000, period: "YEAR" } },
  ],
  rotating: {
    rate: 5,
    capAmount: 1500,
    quarters: [{ year: 2026, quarter: 3, categories: ["GAS"] }],
  },
};

const validInput: RewardProfileInput = {
  currency: "POINTS",
  programName: "Ultimate Rewards",
  centsPerPoint: 1.25,
  baseRate: 1,
  rules: [{ category: "DINING", rate: 3 }],
  rotating: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  householdMock.mockResolvedValue({ userId: "u1", householdId: "h1" } as Awaited<ReturnType<typeof requireCapability>>);
  account.findFirst.mockResolvedValue({
    id: "a1",
    name: "Freedom Flex",
    type: "CREDIT_CARD",
    cardRewardProfile: null,
  } as never);
  profile.findFirst.mockResolvedValue(storedProfile as never);
  profile.create.mockResolvedValue({ id: "p1" } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("demo mode", () => {
  it("short-circuits every action without writing", async () => {
    demoMode.value = true;
    expect(await createRewardProfileAction("a1", null)).toEqual({ ok: true });
    expect(await updateRewardProfileAction("p1", validInput)).toEqual({ ok: true });
    expect(await deleteRewardProfileAction("p1")).toEqual({ ok: true });
    expect(await setCapProgressAction("p1", "GROCERIES", 100)).toEqual({ ok: true });
    expect(await setRotatingActivatedAction("p1", true)).toEqual({ ok: true });
    expect(householdMock).not.toHaveBeenCalled();
    expect(profile.create).not.toHaveBeenCalled();
    expect(progress.upsert).not.toHaveBeenCalled();
  });
});

describe("createRewardProfileAction", () => {
  it("rejects an account from another household", async () => {
    account.findFirst.mockResolvedValue(null);
    expect(await createRewardProfileAction("a1", null)).toEqual({ ok: false, error: "Account not found" });
    expect(account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", householdId: "h1" } }),
    );
  });

  it("rejects accounts that aren't credit cards", async () => {
    account.findFirst.mockResolvedValue({ id: "a1", name: "Checking", type: "CHECKING", cardRewardProfile: null } as never);
    expect(await createRewardProfileAction("a1", null)).toEqual({
      ok: false,
      error: "Only credit cards earn rewards",
    });
    expect(profile.create).not.toHaveBeenCalled();
  });

  it("rejects a card that already has a profile", async () => {
    account.findFirst.mockResolvedValue({
      id: "a1",
      name: "Flex",
      type: "CREDIT_CARD",
      cardRewardProfile: { id: "p0" },
    } as never);
    const result = await createRewardProfileAction("a1", null);
    expect(result.ok).toBe(false);
    expect(profile.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown catalog id", async () => {
    expect(await createRewardProfileAction("a1", "not-a-card")).toEqual({ ok: false, error: "Unknown card" });
  });

  it("pre-fills from the catalog", async () => {
    const card = findCatalogCard("chase-freedom-flex")!;
    expect(await createRewardProfileAction("a1", card.id)).toEqual({ ok: true });
    expect(profile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "h1",
        financialAccountId: "a1",
        catalogCardId: card.id,
        currency: card.currency,
        baseRate: card.baseRate,
        rules: card.rules,
        rotating: card.rotating,
      }),
    });
  });

  it("creates a blank 1x profile for a custom card", async () => {
    expect(await createRewardProfileAction("a1", null)).toEqual({ ok: true });
    expect(profile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ catalogCardId: null, currency: "CASH", baseRate: 1, rules: [] }),
    });
  });
});

describe("updateRewardProfileAction", () => {
  it("saves valid input", async () => {
    expect(await updateRewardProfileAction("p1", validInput)).toEqual({ ok: true });
    expect(profile.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: expect.objectContaining({ currency: "POINTS", centsPerPoint: 1.25, rules: validInput.rules }),
    });
  });

  it("rejects duplicate category rules", async () => {
    const input = {
      ...validInput,
      rules: [
        { category: "DINING", rate: 3 },
        { category: "DINING", rate: 4 },
      ],
    } as RewardProfileInput;
    expect(await updateRewardProfileAction("p1", input)).toEqual({
      ok: false,
      error: "Each category can only have one rate",
    });
    expect(profile.update).not.toHaveBeenCalled();
  });

  it("rejects a profile from another household", async () => {
    profile.findFirst.mockResolvedValue(null);
    expect(await updateRewardProfileAction("p1", validInput)).toEqual({
      ok: false,
      error: "Rewards profile not found",
    });
    expect(profile.update).not.toHaveBeenCalled();
  });
});

describe("deleteRewardProfileAction", () => {
  it("scopes the lookup to the household", async () => {
    expect(await deleteRewardProfileAction("p1")).toEqual({ ok: true });
    expect(profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", householdId: "h1" } }),
    );
    expect(profile.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("refuses to delete another household's profile", async () => {
    profile.findFirst.mockResolvedValue(null);
    const result = await deleteRewardProfileAction("p1");
    expect(result.ok).toBe(false);
    expect(profile.delete).not.toHaveBeenCalled();
  });
});

describe("setCapProgressAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
  });

  it("rejects a rate without a cap", async () => {
    expect(await setCapProgressAction("p1", "DINING", 100)).toEqual({ ok: false, error: "That rate has no cap" });
    expect(progress.upsert).not.toHaveBeenCalled();
  });

  it("rejects negative spend", async () => {
    const result = await setCapProgressAction("p1", "GROCERIES", -5);
    expect(result.ok).toBe(false);
    expect(progress.upsert).not.toHaveBeenCalled();
  });

  it("upserts into the rule's cap period", async () => {
    expect(await setCapProgressAction("p1", "GROCERIES", 250)).toEqual({ ok: true });
    const start = new Date("2026-01-01T00:00:00Z");
    expect(progress.upsert).toHaveBeenCalledWith({
      where: { profileId_capKey_periodStart: { profileId: "p1", capKey: "GROCERIES", periodStart: start } },
      create: { householdId: "h1", profileId: "p1", capKey: "GROCERIES", periodStart: start, spent: 250 },
      update: { spent: 250 },
    });
  });

  it("uses the quarter for the rotating cap", async () => {
    expect(await setCapProgressAction("p1", "ROTATING", 600)).toEqual({ ok: true });
    expect(progress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          profileId_capKey_periodStart: {
            profileId: "p1",
            capKey: "ROTATING",
            periodStart: new Date("2026-07-01T00:00:00Z"),
          },
        },
      }),
    );
  });
});

describe("setRotatingActivatedAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
  });

  it("upserts the current quarter's activation", async () => {
    expect(await setRotatingActivatedAction("p1", true)).toEqual({ ok: true });
    const start = new Date("2026-07-01T00:00:00Z");
    expect(progress.upsert).toHaveBeenCalledWith({
      where: { profileId_capKey_periodStart: { profileId: "p1", capKey: "ROTATING", periodStart: start } },
      create: { householdId: "h1", profileId: "p1", capKey: "ROTATING", periodStart: start, activated: true },
      update: { activated: true },
    });
  });

  it("rejects a card without rotating categories", async () => {
    profile.findFirst.mockResolvedValue({ ...storedProfile, rotating: null } as never);
    expect(await setRotatingActivatedAction("p1", true)).toEqual({
      ok: false,
      error: "This card has no rotating categories",
    });
    expect(progress.upsert).not.toHaveBeenCalled();
  });
});
