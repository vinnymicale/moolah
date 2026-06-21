// Action-layer tests for categories.ts. These cover the demo-mode short-circuit,
// ownership checks, schema validation, and the empty-string-to-null defaulting
// of color/icon/parentId - by stubbing prisma, session, and cache.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import {
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
} from "./categories";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

const requireUserMock = vi.mocked(requireUser);
const category = vi.mocked(prisma.category);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("demo-mode guard", () => {
  beforeEach(() => {
    demoMode.value = true;
  });

  it("createCategoryAction is a no-op success in demo mode", async () => {
    expect(await createCategoryAction({ name: "Food", kind: "EXPENSE" })).toEqual({ ok: true });
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(category.create).not.toHaveBeenCalled();
  });

  it("deleteCategoryAction is a no-op success in demo mode", async () => {
    expect(await deleteCategoryAction("c1")).toEqual({ ok: true });
    expect(category.delete).not.toHaveBeenCalled();
  });
});

describe("createCategoryAction", () => {
  it("creates a category with defaults filled in for blank color/icon/parent", async () => {
    const result = await createCategoryAction({ name: "Food", kind: "EXPENSE", color: "", icon: "", parentId: "" });
    expect(result).toEqual({ ok: true });
    expect(category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        name: "Food",
        kind: "EXPENSE",
        color: "#64748b",
        icon: "tag",
        parentId: null,
      }),
    });
  });

  it("keeps a supplied parentId", async () => {
    await createCategoryAction({ name: "Groceries", kind: "EXPENSE", parentId: "p1" });
    expect(category.create.mock.calls[0][0].data.parentId).toBe("p1");
  });

  it("rejects an empty name", async () => {
    const result = await createCategoryAction({ name: "", kind: "EXPENSE" });
    expect(result).toEqual({ ok: false, error: "Name is required" });
    expect(category.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid kind", async () => {
    const result = await createCategoryAction({ name: "Food", kind: "TRANSFER" as never });
    expect(result.ok).toBe(false);
    expect(category.create).not.toHaveBeenCalled();
  });
});

describe("updateCategoryAction", () => {
  it("errors when the category does not belong to the user", async () => {
    category.findFirst.mockResolvedValue(null);
    const result = await updateCategoryAction("c1", { name: "Food", kind: "EXPENSE" });
    expect(result).toEqual({ ok: false, error: "Category not found" });
    expect(category.findFirst).toHaveBeenCalledWith({ where: { id: "c1", userId: "u1" } });
    expect(category.update).not.toHaveBeenCalled();
  });

  it("updates an owned category", async () => {
    category.findFirst.mockResolvedValue({ id: "c1" } as never);
    const result = await updateCategoryAction("c1", { name: "Dining", kind: "EXPENSE" });
    expect(result).toEqual({ ok: true });
    expect(category.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ name: "Dining", kind: "EXPENSE" }),
    });
  });
});

describe("deleteCategoryAction", () => {
  it("deletes an owned category", async () => {
    category.findFirst.mockResolvedValue({ id: "c1" } as never);
    const result = await deleteCategoryAction("c1");
    expect(result).toEqual({ ok: true });
    expect(category.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("errors when the category does not belong to the user", async () => {
    category.findFirst.mockResolvedValue(null);
    const result = await deleteCategoryAction("c1");
    expect(result).toEqual({ ok: false, error: "Category not found" });
    expect(category.delete).not.toHaveBeenCalled();
  });
});
