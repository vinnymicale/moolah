import { describe, it, expect } from "vitest";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_OPTIONS,
  LIABILITY_TYPES,
  defaultIncludeInCash,
} from "./account-meta";

describe("account-meta", () => {
  it("labels every account type", () => {
    for (const opt of ACCOUNT_TYPE_OPTIONS) {
      expect(opt.label).toBe(ACCOUNT_TYPE_LABELS[opt.value]);
    }
    expect(ACCOUNT_TYPE_OPTIONS).toHaveLength(Object.keys(ACCOUNT_TYPE_LABELS).length);
  });

  it("marks liability types as not assets", () => {
    for (const opt of ACCOUNT_TYPE_OPTIONS) {
      expect(opt.isAsset).toBe(!LIABILITY_TYPES.includes(opt.value));
    }
    const liabilityOptions = ACCOUNT_TYPE_OPTIONS.filter((o) => !o.isAsset).map((o) => o.value);
    expect(liabilityOptions).toEqual(LIABILITY_TYPES);
  });

  it("treats only checking, savings, and cash as spendable cash by default", () => {
    expect(defaultIncludeInCash("CHECKING")).toBe(true);
    expect(defaultIncludeInCash("SAVINGS")).toBe(true);
    expect(defaultIncludeInCash("CASH")).toBe(true);
    expect(defaultIncludeInCash("CREDIT_CARD")).toBe(false);
    expect(defaultIncludeInCash("INVESTMENT")).toBe(false);
    expect(defaultIncludeInCash("PROPERTY")).toBe(false);
  });
});
