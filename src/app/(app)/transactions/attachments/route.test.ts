import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unzipSync, strFromU8 } from "fflate";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/user-tz", () => ({ userTodayISO: vi.fn(async () => "2026-07-23") }));
vi.mock("@/lib/queries", () => ({
  getAccounts: vi.fn(async () => [{ id: "acc1", name: "Checking" }]),
  getCategories: vi.fn(async () => [{ id: "cat1", name: "Groceries" }]),
  getTransactionsBetween: vi.fn(),
}));
vi.mock("@/lib/demo-data", () => ({
  DEMO_ACCOUNTS: [],
  DEMO_CATEGORIES: [],
  DEMO_TRANSACTIONS: [],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { attachment: { findFirst: vi.fn() } },
}));

import { GET } from "./route";
import { requireUser } from "@/lib/session";
import { getTransactionsBetween } from "@/lib/queries";
import { prisma } from "@/lib/prisma";

function req(qs = "") {
  return { nextUrl: new URL(`http://x/transactions/attachments${qs}`) } as never;
}

const txnWithAtt = {
  id: "a3f1c2990000",
  type: "EXPENSE",
  amount: 82.4,
  date: "2026-07-14",
  description: "Costco",
  note: null,
  accountId: "acc1",
  categoryId: "cat1",
  cleared: true,
  tags: [{ id: "t1", name: "tax", color: "#000" }],
  attachments: [{ id: "att1", filename: "receipt.jpg", mimeType: "image/jpeg", size: 3 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEMO_MODE;
  (requireUser as never as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u1" });
  (prisma.attachment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ data: Buffer.from("abc") });
});

afterEach(() => {
  delete process.env.DEMO_MODE;
  vi.resetModules();
});

describe("attachments zip route", () => {
  it("returns a plain message in demo mode", async () => {
    process.env.DEMO_MODE = "true";
    vi.resetModules();
    const mod = await import("./route");
    const res = await mod.GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect((await res.text()).toLowerCase()).toContain("demo");
  });

  it("409 when no attachments match", async () => {
    (getTransactionsBetween as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...txnWithAtt, attachments: [] }]);
    const res = await GET(req());
    expect(res.status).toBe(409);
  });

  it("413 when file count exceeds the cap", async () => {
    const many = Array.from({ length: 5001 }, (_, i) => ({
      ...txnWithAtt,
      id: `id${i}`,
      attachments: [{ id: `att${i}`, filename: "r.jpg", mimeType: "image/jpeg", size: 1 }],
    }));
    (getTransactionsBetween as ReturnType<typeof vi.fn>).mockResolvedValue(many);
    const res = await GET(req());
    expect(res.status).toBe(413);
  });

  it("413 when total bytes exceed the cap", async () => {
    (getTransactionsBetween as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...txnWithAtt, attachments: [{ id: "big", filename: "r.jpg", mimeType: "image/jpeg", size: 2 * 1024 * 1024 * 1024 + 1 }] },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(413);
  });

  it("streams a zip with manifest.csv first and the attachment entry", async () => {
    (getTransactionsBetween as ReturnType<typeof vi.fn>).mockResolvedValue([txnWithAtt]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain('filename="attachments-');
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf);
    const names = Object.keys(files);
    expect(names).toContain("manifest.csv");
    const manifest = strFromU8(files["manifest.csv"]);
    expect(manifest.split("\n")[0]).toBe(
      "File,Date,Type,Amount,Description,Category,Account,Tags,Cleared,Note,TransactionId,AttachmentId",
    );
    const attName = names.find((n) => n !== "manifest.csv")!;
    expect(attName).toBe("2026-07-14_Costco_-82.40_a3f1c2_receipt.jpg");
    expect(strFromU8(files[attName])).toBe("abc");
  });

  it("scopes the byte fetch to the session user", async () => {
    (getTransactionsBetween as ReturnType<typeof vi.fn>).mockResolvedValue([txnWithAtt]);
    await GET(req());
    expect(prisma.attachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "att1", userId: "u1" } }),
    );
  });

  it("dedupes colliding filenames and reflects them in the manifest", async () => {
    (getTransactionsBetween as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ...txnWithAtt,
        attachments: [
          { id: "att1", filename: "receipt.jpg", mimeType: "image/jpeg", size: 3 },
          { id: "att2", filename: "receipt.jpg", mimeType: "image/jpeg", size: 3 },
        ],
      },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf);
    const names = Object.keys(files);
    expect(names).toContain("2026-07-14_Costco_-82.40_a3f1c2_receipt.jpg");
    expect(names).toContain("2026-07-14_Costco_-82.40_a3f1c2_receipt-2.jpg");

    const manifest = strFromU8(files["manifest.csv"]);
    const fileColumn = manifest
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[0]);
    expect(fileColumn).toContain("2026-07-14_Costco_-82.40_a3f1c2_receipt.jpg");
    expect(fileColumn).toContain("2026-07-14_Costco_-82.40_a3f1c2_receipt-2.jpg");
  });
});
