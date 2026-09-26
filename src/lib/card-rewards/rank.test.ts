import { describe, it, expect } from "vitest";
import {
  EVERYTHING_ELSE,
  currentQuarter,
  periodStart,
  rankCards,
  type CapProgressDTO,
  type RankInputProfile,
} from "./rank";

const today = new Date("2026-11-10T15:00:00Z");

function card(over: Partial<RankInputProfile> & { name: string }): RankInputProfile {
  return {
    profileId: `p-${over.name}`,
    accountId: `a-${over.name}`,
    color: "#000",
    currency: "CASH",
    centsPerPoint: 1,
    baseRate: 1,
    rules: [],
    rotating: null,
    ...over,
  };
}

function row(over: Partial<CapProgressDTO> & { profileId: string; capKey: string; periodStart: string }): CapProgressDTO {
  return { spent: 0, activated: false, ...over };
}

function pick(rankings: ReturnType<typeof rankCards>, category: string) {
  const r = rankings.find((x) => x.category === category);
  if (!r) throw new Error(`no ranking for ${category}`);
  return r;
}

const flex = card({
  name: "Flex",
  rotating: {
    rate: 5,
    capAmount: 1500,
    quarters: [
      { year: 2026, quarter: 4, categories: ["ONLINE_SHOPPING", "WAREHOUSE_CLUBS"] },
      { year: 2027, quarter: 1, categories: ["GAS"] },
    ],
  },
  rules: [{ category: "DINING", rate: 3 }],
});

describe("period helpers", () => {
  it("finds the quarter and period starts in UTC", () => {
    expect(currentQuarter(today)).toEqual({ year: 2026, quarter: 4 });
    expect(currentQuarter(new Date("2026-03-31T23:59:59Z"))).toEqual({ year: 2026, quarter: 1 });
    expect(periodStart("MONTH", today).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(periodStart("QUARTER", today).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(periodStart("YEAR", today).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(periodStart("QUARTER", new Date("2026-06-30T12:00:00Z")).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("rankCards", () => {
  it("returns one ranking per category plus everything else", () => {
    const r = rankCards([], [], today, "effective");
    expect(r).toHaveLength(14);
    expect(r[r.length - 1].category).toBe(EVERYTHING_ELSE);
    expect(r.every((x) => x.winner === null)).toBe(true);
  });

  it("prefers a category rule over another card's base rate", () => {
    const dc = card({ name: "Double", baseRate: 2 });
    const r = rankCards([flex, dc], [], today, "effective");
    expect(pick(r, "DINING").winner).toMatchObject({ name: "Flex", rate: 3, source: "rule" });
    expect(pick(r, "DINING").runnerUp).toMatchObject({ name: "Double", rate: 2, source: "base" });
    expect(pick(r, "GROCERIES").winner).toMatchObject({ name: "Double", source: "base" });
    expect(pick(r, EVERYTHING_ELSE).winner).toMatchObject({ name: "Double", rate: 2 });
  });

  it("uses the rotating rate only when this quarter is activated", () => {
    const dc = card({ name: "Double", baseRate: 2 });
    const inactive = rankCards([flex, dc], [], today, "effective");
    expect(pick(inactive, "ONLINE_SHOPPING").winner).toMatchObject({ name: "Double" });
    expect(pick(inactive, "ONLINE_SHOPPING").activateHint).toMatchObject({ name: "Flex", rate: 5, source: "rotating" });

    const progress = [row({ profileId: flex.profileId, capKey: "ROTATING", periodStart: "2026-10-01", activated: true })];
    const active = rankCards([flex, dc], progress, today, "effective");
    expect(pick(active, "ONLINE_SHOPPING").winner).toMatchObject({ name: "Flex", rate: 5, source: "rotating" });
    expect(pick(active, "ONLINE_SHOPPING").activateHint).toBeNull();
  });

  it("ignores activation from a previous quarter and categories from other quarters", () => {
    const progress = [row({ profileId: flex.profileId, capKey: "ROTATING", periodStart: "2026-07-01", activated: true })];
    const r = rankCards([flex], progress, today, "effective");
    expect(pick(r, "ONLINE_SHOPPING").winner).toMatchObject({ source: "base" });
    expect(pick(r, "GAS").winner).toMatchObject({ source: "base" });
    expect(pick(r, "GAS").activateHint).toBeNull();
  });

  it("falls back when a rule cap is used up", () => {
    const amex = card({
      name: "Amex",
      rules: [{ category: "GROCERIES", rate: 6, cap: { amount: 6000, period: "YEAR" } }],
    });
    const dc = card({ name: "Double", baseRate: 2 });
    const under = rankCards([amex, dc], [row({ profileId: amex.profileId, capKey: "GROCERIES", periodStart: "2026-01-01", spent: 5999 })], today, "effective");
    expect(pick(under, "GROCERIES").winner).toMatchObject({ name: "Amex", rate: 6 });

    const over = rankCards([amex, dc], [row({ profileId: amex.profileId, capKey: "GROCERIES", periodStart: "2026-01-01", spent: 6000 })], today, "effective");
    expect(pick(over, "GROCERIES").winner).toMatchObject({ name: "Double", rate: 2 });
    expect(pick(over, "GROCERIES").cappedOut).toEqual(["Amex"]);

    const lastYear = rankCards([amex, dc], [row({ profileId: amex.profileId, capKey: "GROCERIES", periodStart: "2025-01-01", spent: 9000 })], today, "effective");
    expect(pick(lastYear, "GROCERIES").winner).toMatchObject({ name: "Amex" });
  });

  it("falls back when the rotating cap is used up", () => {
    const progress = [
      row({ profileId: flex.profileId, capKey: "ROTATING", periodStart: "2026-10-01", activated: true, spent: 1500 }),
    ];
    const r = rankCards([flex], progress, today, "effective");
    expect(pick(r, "ONLINE_SHOPPING").winner).toMatchObject({ source: "base", rate: 1 });
    expect(pick(r, "ONLINE_SHOPPING").cappedOut).toEqual(["Flex"]);
  });

  it("orders by raw multiplier or by effective value", () => {
    const sapphire = card({ name: "Sapphire", currency: "POINTS", centsPerPoint: 1.25, rules: [{ category: "DINING", rate: 3 }] });
    const dc = card({ name: "Double", baseRate: 2 });
    const store = card({ name: "Store", currency: "POINTS", centsPerPoint: 0.5, rules: [{ category: "DINING", rate: 4 }] });

    const eff = rankCards([sapphire, dc, store], [], today, "effective");
    expect(pick(eff, "DINING").winner).toMatchObject({ name: "Sapphire", effectivePct: 3.75 });
    expect(pick(eff, "DINING").runnerUp).toMatchObject({ name: "Double", effectivePct: 2 });

    const raw = rankCards([sapphire, dc, store], [], today, "raw");
    expect(pick(raw, "DINING").winner).toMatchObject({ name: "Store", rate: 4 });
    expect(pick(raw, "DINING").runnerUp).toMatchObject({ name: "Sapphire" });
  });

  it("breaks exact ties by name", () => {
    const b = card({ name: "Bravo", baseRate: 2 });
    const a = card({ name: "Alpha", baseRate: 2 });
    expect(pick(rankCards([b, a], [], today, "effective"), EVERYTHING_ELSE).winner?.name).toBe("Alpha");
  });

  it("uses only the base rate for everything else", () => {
    const r = rankCards([flex], [], today, "effective");
    expect(pick(r, EVERYTHING_ELSE).winner).toMatchObject({ rate: 1, source: "base" });
    expect(pick(r, EVERYTHING_ELSE).runnerUp).toBeNull();
  });
});
