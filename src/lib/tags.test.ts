import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { tag: { findMany: vi.fn(), create: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action-result";
import { normalizeTagName, resolveTagIds, MAX_TAG_NAME_LENGTH } from "./tags";

const findMany = vi.mocked(prisma.tag.findMany);
const create = vi.mocked(prisma.tag.create);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeTagName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normalizeTagName("  vacation   2026 ")).toBe("vacation 2026");
  });

  it("rejects empty names", () => {
    expect(() => normalizeTagName("   ")).toThrow(UserError);
  });

  it("rejects names over 40 characters and allows exactly 40", () => {
    expect(() => normalizeTagName("x".repeat(MAX_TAG_NAME_LENGTH + 1))).toThrow(UserError);
    expect(normalizeTagName("x".repeat(MAX_TAG_NAME_LENGTH))).toBe("x".repeat(40));
  });
});

describe("resolveTagIds", () => {
  it("returns [] for empty input without touching the db", async () => {
    expect(await resolveTagIds("u1", [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("resolves an existing tag case-insensitively instead of creating", async () => {
    findMany.mockResolvedValue([{ id: "t1", name: "Vacation" }] as never);
    expect(await resolveTagIds("u1", ["vacation"])).toEqual(["t1"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates missing tags with the name as typed", async () => {
    findMany.mockResolvedValue([] as never);
    create.mockResolvedValue({ id: "t2" } as never);
    expect(await resolveTagIds("u1", [" beach   trip "])).toEqual(["t2"]);
    expect(create).toHaveBeenCalledWith({
      data: { userId: "u1", name: "beach trip" },
      select: { id: true },
    });
  });

  it("dedups case-insensitive duplicates in the input", async () => {
    findMany.mockResolvedValue([{ id: "t1", name: "Trip" }] as never);
    expect(await resolveTagIds("u1", ["Trip", "trip"])).toEqual(["t1"]);
  });
});
