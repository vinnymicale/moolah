import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tag: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    transaction: { findMany: vi.fn(), update: vi.fn() },
    rule: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  createTagAction,
  renameTagAction,
  setTagColorAction,
  deleteTagAction,
  mergeTagsAction,
} from "./tags";

const requireUserMock = vi.mocked(requireUser);
const tagFindFirst = vi.mocked(prisma.tag.findFirst);
const tagCreate = vi.mocked(prisma.tag.create);
const tagUpdate = vi.mocked(prisma.tag.update);
const tagDelete = vi.mocked(prisma.tag.delete);
const txnFindMany = vi.mocked(prisma.transaction.findMany);
const ruleFindMany = vi.mocked(prisma.rule.findMany);
const ruleUpdate = vi.mocked(prisma.rule.update);

const owned = { id: "t1", userId: "u1", name: "vacation", color: "#64748b" };

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
});

describe("createTagAction", () => {
  it("is a no-op in demo mode", async () => {
    demoMode.value = true;
    const res = await createTagAction({ name: "x" });
    expect(res.ok).toBe(true);
    expect(tagCreate).not.toHaveBeenCalled();
  });

  it("normalizes the name and applies the default color", async () => {
    tagFindFirst.mockResolvedValue(null);
    tagCreate.mockResolvedValue({ id: "t9" } as never);
    const res = await createTagAction({ name: "  vacation   2026 " });
    expect(res).toEqual({ ok: true, id: "t9" });
    expect(tagCreate).toHaveBeenCalledWith({
      data: { userId: "u1", name: "vacation 2026", color: "#64748b" },
      select: { id: true },
    });
  });

  it("rejects a case-insensitive duplicate name", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    const res = await createTagAction({ name: "VACATION" });
    expect(res).toEqual({ ok: false, error: "A tag with that name already exists" });
  });
});

describe("renameTagAction", () => {
  it("errors when the tag is not owned", async () => {
    tagFindFirst.mockResolvedValue(null);
    const res = await renameTagAction("t1", "new");
    expect(res).toEqual({ ok: false, error: "Tag not found" });
  });

  it("rejects renaming onto another tag's name", async () => {
    tagFindFirst.mockResolvedValueOnce(owned as never);
    tagFindFirst.mockResolvedValueOnce({ id: "t2" } as never);
    const res = await renameTagAction("t1", "reimbursable");
    expect(res).toEqual({ ok: false, error: "A tag with that name already exists" });
    expect(tagUpdate).not.toHaveBeenCalled();
  });

  it("renames when the name is free", async () => {
    tagFindFirst.mockResolvedValueOnce(owned as never);
    tagFindFirst.mockResolvedValueOnce(null);
    const res = await renameTagAction("t1", "  new   name ");
    expect(res).toEqual({ ok: true });
    expect(tagUpdate).toHaveBeenCalledWith({ where: { id: "t1" }, data: { name: "new name" } });
  });
});

describe("setTagColorAction", () => {
  it("updates the color on an owned tag", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    const res = await setTagColorAction("t1", "#dc2626");
    expect(res).toEqual({ ok: true });
    expect(tagUpdate).toHaveBeenCalledWith({ where: { id: "t1" }, data: { color: "#dc2626" } });
  });
});

describe("deleteTagAction", () => {
  it("deletes an owned tag", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    const res = await deleteTagAction("t1");
    expect(res).toEqual({ ok: true });
    expect(tagDelete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });
});

describe("mergeTagsAction", () => {
  it("rejects merging a tag into itself", async () => {
    const res = await mergeTagsAction("t1", "t1");
    expect(res).toEqual({ ok: false, error: "Pick two different tags" });
  });

  it("re-points transactions, rewrites rules, and deletes the source", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    txnFindMany.mockResolvedValue([{ id: "x1" }, { id: "x2" }] as never);
    ruleFindMany.mockResolvedValue([
      {
        id: "r1",
        actions: [
          { type: "addTag", tagId: "src" },
          { type: "setCategory", categoryId: "c1" },
        ],
      },
    ] as never);

    const res = await mergeTagsAction("src", "tgt");
    expect(res).toEqual({ ok: true });
    // only transactions NOT already carrying the target get connected
    expect(txnFindMany).toHaveBeenCalledWith({
      where: { userId: "u1", tags: { some: { id: "src" } }, NOT: { tags: { some: { id: "tgt" } } } },
      select: { id: true },
    });
    expect(tagDelete).toHaveBeenCalledWith({ where: { id: "src" } });
    expect(ruleUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: {
        actions: [
          { type: "addTag", tagId: "tgt" },
          { type: "setCategory", categoryId: "c1" },
        ],
      },
    });
  });

  it("dedups when a rule already adds the target tag", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    txnFindMany.mockResolvedValue([] as never);
    ruleFindMany.mockResolvedValue([
      {
        id: "r1",
        actions: [
          { type: "addTag", tagId: "src" },
          { type: "addTag", tagId: "tgt" },
        ],
      },
    ] as never);

    await mergeTagsAction("src", "tgt");
    expect(ruleUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { actions: [{ type: "addTag", tagId: "tgt" }] },
    });
  });

  it("leaves rules without the source tag untouched", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    txnFindMany.mockResolvedValue([] as never);
    ruleFindMany.mockResolvedValue([
      { id: "r1", actions: [{ type: "setCategory", categoryId: "c1" }] },
    ] as never);

    await mergeTagsAction("src", "tgt");
    expect(ruleUpdate).not.toHaveBeenCalled();
  });
});
