import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { create } } }));

const { recordAudit } = await import("./audit");

describe("recordAudit", () => {
  it("writes the entry", async () => {
    await recordAudit({
      householdId: "hh_1",
      actorId: "u_1",
      action: "transaction.delete",
      entityType: "Transaction",
      entityId: "t_1",
      summary: "Groceries $84.10",
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "transaction.delete", entityId: "t_1" }),
    });
  });

  it("never lets a logging failure break the mutation that triggered it", async () => {
    create.mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordAudit({ householdId: "hh_1", actorId: null, action: "x", entityType: "Y" }),
    ).resolves.toBeUndefined();
  });
});
