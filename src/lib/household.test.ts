import { describe, it, expect, vi, beforeEach } from "vitest";
import { CAPABILITIES } from "./capabilities";
import { getHouseholdContext, checkCapability, checkAdmin, ForbiddenError } from "./household";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: { householdMember: { findUnique: vi.fn() } },
}));

// requireHousehold pulls in next-auth via the session helper; these tests only
// exercise the capability resolution, so the session layer is stubbed out.
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const findUnique = vi.mocked(prisma.householdMember.findUnique);

function member(role: string, capabilities: string[] = [], deniedCapabilities: string[] = []) {
  return { householdId: "h1", role, capabilities, deniedCapabilities } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("getHouseholdContext", () => {
  it("returns null when the user belongs to no household", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getHouseholdContext("u1")).toBeNull();
  });

  it("resolves the member's capabilities from role plus overrides", async () => {
    findUnique.mockResolvedValue(member("VIEWER", ["MANAGE_BUDGETS"], ["VIEW_DEBT"]));
    const ctx = await getHouseholdContext("u1");
    expect(ctx).not.toBeNull();
    expect(ctx!.householdId).toBe("h1");
    expect(ctx!.role).toBe("VIEWER");
    expect(ctx!.can("MANAGE_BUDGETS")).toBe(true);
    expect(ctx!.can("VIEW_DEBT")).toBe(false);
    expect(ctx!.can("VIEW_DASHBOARD")).toBe(true);
  });

  it("treats an admin as able to do everything", async () => {
    findUnique.mockResolvedValue(member("ADMIN", [], ["MANAGE_RULES"]));
    const ctx = await getHouseholdContext("u1");
    expect(ctx!.can("MANAGE_RULES")).toBe(true);
    expect(ctx!.isAdmin).toBe(true);
  });

  it("does not treat a member as an admin", async () => {
    findUnique.mockResolvedValue(member("MEMBER"));
    expect((await getHouseholdContext("u1"))!.isAdmin).toBe(false);
  });
});

describe("checkCapability", () => {
  it("passes when the capability is held", async () => {
    findUnique.mockResolvedValue(member("MEMBER"));
    const ctx = await getHouseholdContext("u1");
    expect(() => checkCapability(ctx!, "MANAGE_BUDGETS")).not.toThrow();
  });

  it("throws ForbiddenError naming the capability when it is missing", async () => {
    findUnique.mockResolvedValue(member("VIEWER"));
    const ctx = await getHouseholdContext("u1");
    expect(() => checkCapability(ctx!, "MANAGE_BUDGETS")).toThrow(ForbiddenError);
    expect(() => checkCapability(ctx!, "MANAGE_BUDGETS")).toThrow(/MANAGE_BUDGETS/);
  });
});

describe("checkAdmin", () => {
  it("passes for an owner", async () => {
    findUnique.mockResolvedValue(member("OWNER"));
    const ctx = await getHouseholdContext("u1");
    expect(() => checkAdmin(ctx!)).not.toThrow();
  });

  it("throws for a member even with every capability granted", async () => {
    findUnique.mockResolvedValue(member("MEMBER", [...CAPABILITIES]));
    const ctx = await getHouseholdContext("u1");
    expect(() => checkAdmin(ctx!)).toThrow(ForbiddenError);
  });
});
