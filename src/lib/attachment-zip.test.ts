import { describe, it, expect } from "vitest";
import {
  sanitizeComponent,
  signedAmount,
  buildZipFilename,
  dedupeFilenames,
  MANIFEST_HEADER,
  manifestRow,
  toCsv,
  type ZipTxnMeta,
} from "./attachment-zip";

const txn: ZipTxnMeta = {
  id: "a3f1c299-0000",
  type: "EXPENSE",
  amount: 82.4,
  date: "2026-07-14",
  description: "Costco / weekly",
  note: "food, household",
  categoryName: "Groceries",
  accountName: "Checking",
  tags: ["tax", "reimburse"],
  cleared: true,
};

describe("sanitizeComponent", () => {
  it("strips path separators and control chars", () => {
    expect(sanitizeComponent("a/b\\c d", 40)).toBe("a_b_c_d");
  });
  it("removes filesystem-illegal chars and collapses whitespace", () => {
    expect(sanitizeComponent('a: *?"<>|  b', 40)).toBe("a_b");
  });
  it("clamps to maxLen", () => {
    expect(sanitizeComponent("abcdefghij", 4)).toBe("abcd");
  });
});

describe("signedAmount", () => {
  it("negates expenses", () => {
    expect(signedAmount("EXPENSE", 82.4)).toBe("-82.40");
  });
  it("keeps income positive", () => {
    expect(signedAmount("INCOME", 410)).toBe("410.00");
  });
});

describe("buildZipFilename", () => {
  it("assembles the descriptive name", () => {
    expect(buildZipFilename(txn, { id: "x", filename: "receipt.jpg" })).toBe(
      "2026-07-14_Costco_weekly_-82.40_a3f1c2_receipt.jpg",
    );
  });
});

describe("dedupeFilenames", () => {
  it("suffixes exact duplicates before the extension", () => {
    expect(dedupeFilenames(["r.jpg", "r.jpg", "s.pdf", "r.jpg"])).toEqual([
      "r.jpg",
      "r-2.jpg",
      "s.pdf",
      "r-3.jpg",
    ]);
  });
  it("suffixes duplicates with no extension", () => {
    expect(dedupeFilenames(["r", "r"])).toEqual(["r", "r-2"]);
  });
});

describe("manifest", () => {
  it("has File as the first column", () => {
    expect(MANIFEST_HEADER[0]).toBe("File");
  });
  it("builds a row in header order with signed amount and joined tags", () => {
    const row = manifestRow("2026-07-14_Costco_weekly_-82.40_a3f1c2_receipt.jpg", txn, {
      id: "att1",
      filename: "receipt.jpg",
    });
    expect(row).toEqual([
      "2026-07-14_Costco_weekly_-82.40_a3f1c2_receipt.jpg",
      "2026-07-14",
      "EXPENSE",
      "-82.40",
      "Costco / weekly",
      "Groceries",
      "Checking",
      "tax; reimburse",
      "yes",
      "food, household",
      "a3f1c299-0000",
      "att1",
    ]);
  });
});

describe("toCsv", () => {
  it("quotes fields with commas and escapes quotes", () => {
    expect(toCsv([["a,b", 'he said "hi"']])).toBe('"a,b","he said ""hi"""');
  });
  it("neutralises formula injection", () => {
    expect(toCsv([["=1+1"]])).toBe("'=1+1");
  });
});
