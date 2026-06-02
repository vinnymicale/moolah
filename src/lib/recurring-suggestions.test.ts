import { describe, it, expect } from "vitest";
import {
  detectRecurringCandidates,
  descriptionsLikelySame,
  normalizeDescription,
  type TxnForDetect,
} from "./recurring-suggestions";

function txn(date: string, description: string, amount: number, type: "INCOME" | "EXPENSE" = "EXPENSE"): TxnForDetect {
  return { date, description, amount, type, categoryId: null, accountId: null, recurringRuleId: null };
}

describe("normalizeDescription", () => {
  it("strips reference codes and noise so the same merchant groups together", () => {
    expect(normalizeDescription("SPOTIFY P42DA18")).toBe("spotify");
    expect(normalizeDescription("SPOTIFY P41D0E2")).toBe("spotify");
    expect(normalizeDescription("GOOGLE *YOUTUBE")).toBe("google youtube");
  });

  it("keeps distinct payers distinct", () => {
    expect(normalizeDescription("Early Pay PAYROLL ACH from ANALEX CORP")).toBe("payroll analex corp");
    expect(normalizeDescription("Early Pay PAYROLL ACH from RITE-SOLUTIONS I")).toContain("rite");
  });
});

describe("detectRecurringCandidates", () => {
  it("detects a monthly subscription", () => {
    const txns = [
      txn("2026-03-26", "SPOTIFY", 13.9),
      txn("2026-04-26", "SPOTIFY P41D0E2", 13.9),
      txn("2026-05-26", "SPOTIFY P42DA18", 13.9),
    ];
    const out = detectRecurringCandidates(txns);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ frequency: "MONTHLY", interval: 1, amount: 13.9, count: 3, type: "EXPENSE" });
    expect(out[0].startDate).toBe("2026-05-26");
  });

  it("detects biweekly income", () => {
    const txns = [
      txn("2026-04-16", "PAYROLL ACH from ANALEX", 3085.92, "INCOME"),
      txn("2026-04-30", "PAYROLL ACH from ANALEX", 3085.92, "INCOME"),
      txn("2026-05-14", "PAYROLL ACH from ANALEX", 3085.92, "INCOME"),
      txn("2026-05-28", "PAYROLL ACH from ANALEX", 3085.92, "INCOME"),
    ];
    const out = detectRecurringCandidates(txns);
    expect(out[0]).toMatchObject({ frequency: "BIWEEKLY", type: "INCOME", count: 4 });
  });

  it("ignores groups below the minimum count", () => {
    const txns = [txn("2026-03-26", "SPOTIFY", 13.9), txn("2026-04-26", "SPOTIFY", 13.9)];
    expect(detectRecurringCandidates(txns)).toHaveLength(0);
  });

  it("ignores irregular spending", () => {
    const txns = [
      txn("2026-01-03", "AMAZON", 20),
      txn("2026-01-19", "AMAZON", 55),
      txn("2026-03-02", "AMAZON", 12),
    ];
    expect(detectRecurringCandidates(txns)).toHaveLength(0);
  });

  it("skips transactions already tied to a rule", () => {
    const txns = [
      { ...txn("2026-03-26", "SPOTIFY", 13.9), recurringRuleId: "r1" },
      { ...txn("2026-04-26", "SPOTIFY", 13.9), recurringRuleId: "r1" },
      { ...txn("2026-05-26", "SPOTIFY", 13.9), recurringRuleId: "r1" },
    ];
    expect(detectRecurringCandidates(txns)).toHaveLength(0);
  });

  it("excludes merchants that already have a rule", () => {
    const txns = [
      txn("2026-03-26", "SPOTIFY", 13.9),
      txn("2026-04-26", "SPOTIFY", 13.9),
      txn("2026-05-26", "SPOTIFY", 13.9),
    ];
    const out = detectRecurringCandidates(txns, { existingDescriptions: ["Spotify"] });
    expect(out).toHaveLength(0);
  });

  it("excludes merchants whose rule is named differently", () => {
    const youtube = [
      txn("2026-03-26", "GOOGLE *YOUTUBE", 88.8),
      txn("2026-04-26", "GOOGLE *YOUTUBE", 88.8),
      txn("2026-05-26", "GOOGLE *YOUTUBE", 88.8),
    ];
    expect(detectRecurringCandidates(youtube, { existingDescriptions: ["YouTube Premium"] })).toHaveLength(0);

    const vpn = [
      txn("2026-03-05", "PRIVATEINTERNET", 9.95),
      txn("2026-04-05", "PRIVATEINTERNET", 9.95),
      txn("2026-05-05", "PRIVATEINTERNET", 9.95),
    ];
    expect(detectRecurringCandidates(vpn, { existingDescriptions: ["Private Internet Access (VPN)"] })).toHaveLength(0);
  });
});

describe("descriptionsLikelySame", () => {
  it("matches differently-worded names for the same merchant", () => {
    expect(descriptionsLikelySame("GOOGLE *YOUTUBE", "YouTube Premium")).toBe(true);
    expect(descriptionsLikelySame("PRIVATEINTERNET", "Private Internet Access (VPN)")).toBe(true);
    expect(descriptionsLikelySame("ACH Withdrawal EARNEST MO AUTOPAY", "Earnest student loan")).toBe(true);
  });

  it("does not match unrelated merchants", () => {
    expect(descriptionsLikelySame("SPOTIFY", "YouTube Premium")).toBe(false);
    expect(descriptionsLikelySame("COX COMM RHI", "PPL Rhode Island")).toBe(false);
  });
});
