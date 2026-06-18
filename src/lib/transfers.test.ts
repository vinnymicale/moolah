import { describe, it, expect } from "vitest";
import { isEffectiveTransfer } from "./transfers";

describe("isEffectiveTransfer", () => {
  it("is true for an explicitly paired transfer regardless of account type", () => {
    expect(isEffectiveTransfer({ type: "EXPENSE", isTransfer: true, accountType: "CHECKING" })).toBe(true);
    expect(isEffectiveTransfer({ type: "INCOME", isTransfer: true, accountType: "SAVINGS" })).toBe(true);
  });

  it("treats unpaired CC-account income as a transfer (payment credit, not real income)", () => {
    expect(isEffectiveTransfer({ type: "INCOME", isTransfer: false, accountType: "CREDIT_CARD" })).toBe(true);
  });

  it("does not treat CC-account expenses as transfers (real purchases)", () => {
    expect(isEffectiveTransfer({ type: "EXPENSE", isTransfer: false, accountType: "CREDIT_CARD" })).toBe(false);
  });

  it("does not treat bank-account income as a transfer", () => {
    expect(isEffectiveTransfer({ type: "INCOME", isTransfer: false, accountType: "CHECKING" })).toBe(false);
  });

  it("does not treat income with no account as a transfer", () => {
    expect(isEffectiveTransfer({ type: "INCOME", isTransfer: false, accountType: null })).toBe(false);
  });
});
