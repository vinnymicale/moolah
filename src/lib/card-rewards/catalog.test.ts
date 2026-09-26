import { describe, expect, it } from "vitest";
import { CATALOG, findCatalogCard, matchCatalogCard } from "./catalog";
import { rewardRulesSchema, rotatingProgramSchema } from "./types";

describe("CATALOG", () => {
  it("has valid rules and rotating programs for every card", () => {
    for (const card of CATALOG) {
      expect(rewardRulesSchema.safeParse(card.rules).success, card.id).toBe(true);
      if (card.rotating) {
        expect(rotatingProgramSchema.safeParse(card.rotating).success, card.id).toBe(true);
      }
      expect(card.baseRate).toBeGreaterThan(0);
      expect(card.defaultCentsPerPoint).toBeGreaterThan(0);
      expect(card.verifiedAsOf).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("has unique ids", () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches every card by its own name", () => {
    for (const card of CATALOG) {
      expect(matchCatalogCard(`${card.issuer} ${card.name}`, "")?.id, card.id).toBe(card.id);
    }
  });
});

describe("matchCatalogCard", () => {
  it("matches Freedom Flex by official name", () => {
    expect(matchCatalogCard("Chase Freedom Flex", "")?.id).toBe("chase-freedom-flex");
  });

  it("does not confuse Freedom Unlimited with Flex", () => {
    expect(matchCatalogCard("Chase Freedom Unlimited", "")?.id).toBe("chase-freedom-unlimited");
  });

  it("tries the official name before the account name", () => {
    expect(matchCatalogCard("Chase Freedom Flex", "Citi Double Cash")?.id).toBe("chase-freedom-flex");
  });

  it("falls back to the account name", () => {
    expect(matchCatalogCard(null, "My Double Cash card")?.id).toBe("citi-double-cash");
  });

  it("returns null for unknown cards", () => {
    expect(matchCatalogCard("Some Credit Union Visa", "Visa 1234")).toBeNull();
  });
});

describe("findCatalogCard", () => {
  it("finds by id or returns null", () => {
    expect(findCatalogCard("citi-double-cash")?.name).toBe("Double Cash");
    expect(findCatalogCard("nope")).toBeNull();
  });
});
