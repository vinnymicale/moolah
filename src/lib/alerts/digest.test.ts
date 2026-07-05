import { describe, it, expect } from "vitest";
import { formatDigest, type Digest } from "./digest";

const empty: Digest = {
  todayISO: "2026-07-04",
  billsDays: 3,
  bills: [],
  cardsDue: [],
  overBudget: [],
};

describe("formatDigest", () => {
  it("returns null when there is nothing to report", () => {
    expect(formatDigest(empty)).toBeNull();
  });

  it("lists upcoming bills with dates and amounts", () => {
    const out = formatDigest({
      ...empty,
      bills: [
        { date: "2026-07-05", description: "Rent", amount: 1500 },
        { date: "2026-07-06", description: "Internet", amount: 79.99 },
      ],
    })!;
    expect(out.title).toBe("Moolah: 2 bills upcoming");
    expect(out.body).toContain("Upcoming bills (next 3 days):");
    expect(out.body).toContain("- Jul 5: Rent $1,500.00");
    expect(out.body).toContain("- Jul 6: Internet $79.99");
  });

  it("singularizes a one-day look-ahead and a single bill", () => {
    const out = formatDigest({
      ...empty,
      billsDays: 1,
      bills: [{ date: "2026-07-05", description: "Rent", amount: 1500 }],
    })!;
    expect(out.title).toBe("Moolah: 1 bill upcoming");
    expect(out.body).toContain("next 1 day)");
  });

  it("reports card due dates and flags overdue ones in the title", () => {
    const out = formatDigest({
      ...empty,
      cardsDue: [
        { name: "Sapphire", dueDate: "2026-07-06", amount: 450.25, overdue: false },
        { name: "Freedom", dueDate: "2026-07-01", amount: 120, overdue: true },
      ],
    })!;
    expect(out.title).toBe("Moolah: card overdue");
    expect(out.body).toContain("- Sapphire: $450.25 due Jul 6");
    expect(out.body).toContain("- Freedom: $120.00 was due Jul 1 (OVERDUE)");
  });

  it("counts cards in the title when none are overdue", () => {
    const out = formatDigest({
      ...empty,
      cardsDue: [{ name: "Sapphire", dueDate: "2026-07-06", amount: 450, overdue: false }],
    })!;
    expect(out.title).toBe("Moolah: 1 card due");
  });

  it("shows over-budget categories with the overage", () => {
    const out = formatDigest({
      ...empty,
      overBudget: [{ name: "Dining", limit: 300, actual: 412.5 }],
    })!;
    expect(out.title).toBe("Moolah: 1 over budget");
    expect(out.body).toContain("Over budget this month:");
    expect(out.body).toContain("- Dining: $412.50 spent of $300.00 ($112.50 over)");
  });

  it("joins all sections in card, bill, budget order", () => {
    const out = formatDigest({
      ...empty,
      bills: [{ date: "2026-07-05", description: "Rent", amount: 1500 }],
      cardsDue: [{ name: "Sapphire", dueDate: "2026-07-06", amount: 450, overdue: false }],
      overBudget: [{ name: "Dining", limit: 300, actual: 400 }],
    })!;
    expect(out.title).toBe("Moolah: 1 card due, 1 bill upcoming, 1 over budget");
    const cardIdx = out.body.indexOf("Credit cards due:");
    const billIdx = out.body.indexOf("Upcoming bills");
    const budgetIdx = out.body.indexOf("Over budget");
    expect(cardIdx).toBeGreaterThanOrEqual(0);
    expect(cardIdx).toBeLessThan(billIdx);
    expect(billIdx).toBeLessThan(budgetIdx);
  });
});
