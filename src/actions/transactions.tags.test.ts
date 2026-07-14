import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    transactionSplit: { deleteMany: vi.fn() },
    tag: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
    financialAccount: { findFirst: vi.fn() },
    recurringRule: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createTransactionAction, updateTransactionAction, bulkAddTagAction, bulkRemoveTagAction } from "./transactions";

const requireUserMock = vi.mocked(requireUser);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  // interactive $transaction: run the callback against the same mock delegates
  vi.mocked(prisma.$transaction).mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]),
  );
});

const base = {
  type: "EXPENSE" as const,
  amount: 5,
  date: "2026-07-01",
  description: "Lunch",
};

describe("createTransactionAction tags", () => {
  it("resolves tag names and connects them on create", async () => {
    vi.mocked(prisma.tag.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tag.create).mockResolvedValue({ id: "t9" } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "x1" } as never);

    const res = await createTransactionAction({ ...base, tags: ["Trip"] });
    expect(res.ok).toBe(true);
    const createArg = vi.mocked(prisma.transaction.create).mock.calls[0][0];
    expect(createArg.data.tags).toEqual({ connect: [{ id: "t9" }] });
  });

  it("omits the tags relation when no tags are given", async () => {
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "x1" } as never);
    const res = await createTransactionAction({ ...base });
    expect(res.ok).toBe(true);
    const createArg = vi.mocked(prisma.transaction.create).mock.calls[0][0];
    expect(createArg.data.tags).toBeUndefined();
    expect(prisma.tag.findMany).not.toHaveBeenCalled();
  });
});

describe("updateTransactionAction tags", () => {
  it("replaces tags with set when tags are provided", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "x1", userId: "u1" } as never);
    vi.mocked(prisma.tag.findMany).mockResolvedValue([{ id: "t1", name: "Trip" }] as never);
    vi.mocked(prisma.transaction.update).mockResolvedValue({ id: "x1" } as never);

    const res = await updateTransactionAction("x1", { ...base, tags: ["Trip"] });
    expect(res.ok).toBe(true);
    const updateArg = vi.mocked(prisma.transaction.update).mock.calls[0][0];
    expect(updateArg.data.tags).toEqual({ set: [{ id: "t1" }] });
  });

  it("leaves tags untouched when tags is undefined", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "x1", userId: "u1" } as never);
    vi.mocked(prisma.transaction.update).mockResolvedValue({ id: "x1" } as never);

    const res = await updateTransactionAction("x1", { ...base });
    expect(res.ok).toBe(true);
    const updateArg = vi.mocked(prisma.transaction.update).mock.calls[0][0];
    expect(updateArg.data.tags).toBeUndefined();
  });
});

describe("bulkAddTagAction", () => {
  it("errors when the tag is not owned", async () => {
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null);
    const res = await bulkAddTagAction(["x1"], "t1");
    expect(res).toEqual({ ok: false, error: "Tag not found" });
  });

  it("connects the tag on owned rows that do not already have it", async () => {
    vi.mocked(prisma.tag.findFirst).mockResolvedValue({ id: "t1", userId: "u1" } as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ id: "x1" }, { id: "x2" }] as never);

    const res = await bulkAddTagAction(["x1", "x2", "not-mine"], "t1");
    expect(res).toEqual({ ok: true });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["x1", "x2", "not-mine"] }, NOT: { tags: { some: { id: "t1" } } } },
      select: { id: true },
    });
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "x1" },
      data: { tags: { connect: { id: "t1" } } },
    });
  });
});

describe("bulkRemoveTagAction", () => {
  it("disconnects the tag from owned rows that have it", async () => {
    vi.mocked(prisma.tag.findFirst).mockResolvedValue({ id: "t1", userId: "u1" } as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ id: "x1" }] as never);

    const res = await bulkRemoveTagAction(["x1"], "t1");
    expect(res).toEqual({ ok: true });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["x1"] }, tags: { some: { id: "t1" } } },
      select: { id: true },
    });
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "x1" },
      data: { tags: { disconnect: { id: "t1" } } },
    });
  });
});
