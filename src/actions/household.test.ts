// Membership is the one place where a permission mistake is self-inflicting:
// these actions are how an admin hands out (and takes away) access, and the
// owner guard is what stops a household from ending up with nobody who can
// administer it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// A literal factory, not importOriginal - the real module pulls in next-auth,
// which does not load under the node test environment. The factory is hoisted,
// so the error class is declared inside it and read back off the mock below.
vi.mock("@/lib/household", () => ({ requireAdmin: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("bcryptjs", () => ({ hash: vi.fn(async () => "hashed") }));

vi.mock("@/lib/prisma", () => {
  const client = {
    user: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    household: { findUnique: vi.fn(), update: vi.fn() },
    householdMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return { prisma: client };
});

import {
  addMemberAction,
  removeMemberAction,
  setMemberRoleAction,
  setMemberCapabilitiesAction,
  transferOwnershipAction,
} from "./household";
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { requireAdmin } from "@/lib/household";
// The real class, not a stand-in: run() recognises it with instanceof, which is
// what lets the gate's message reach the UI instead of a generic failure.
import { ForbiddenError } from "@/lib/forbidden";

const adminMock = vi.mocked(requireAdmin);

const user = vi.mocked(prisma.user);
const household = vi.mocked(prisma.household);
const member = vi.mocked(prisma.householdMember);

/** An admin context. Every action here is admin-gated, so can() never runs. */
function ctx(over: { userId: string; role: "OWNER" | "ADMIN" }) {
  return {
    householdId: "h1",
    isAdmin: true,
    can: () => true,
    ...over,
  } as Awaited<ReturnType<typeof requireAdmin>>;
}

/** A membership row as the actions read it, with the owner flag folded in. */
function memberRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "m2",
    householdId: "h1",
    userId: "u2",
    role: "MEMBER",
    capabilities: [],
    deniedCapabilities: [],
    user: { id: "u2", name: "Sam" },
    household: { id: "h1", ownerId: "u1" },
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  adminMock.mockResolvedValue(ctx({ userId: "u1", role: "OWNER" }));
  user.findUnique.mockResolvedValue(null);
  user.create.mockResolvedValue({ id: "u2", name: "Sam" } as never);
  member.create.mockResolvedValue({ id: "m2" } as never);
  member.findFirst.mockResolvedValue(memberRow());
  household.findUnique.mockResolvedValue({ id: "h1", ownerId: "u1" } as never);
});

describe("admin gate", () => {
  const calls: [string, () => Promise<{ ok: boolean }>][] = [
    ["addMemberAction", () => addMemberAction({ name: "Sam", password: "temp-pass-12", role: "MEMBER" })],
    ["removeMemberAction", () => removeMemberAction("m2")],
    ["setMemberRoleAction", () => setMemberRoleAction("m2", "VIEWER")],
    ["setMemberCapabilitiesAction", () => setMemberCapabilitiesAction("m2", [], [])],
    ["transferOwnershipAction", () => transferOwnershipAction("m2")],
  ];

  for (const [name, call] of calls) {
    it(`${name} refuses a non-admin`, async () => {
      adminMock.mockRejectedValue(new ForbiddenError("Only a household admin can do that."));
      const result = await call();
      expect(result).toEqual({ ok: false, error: "Only a household admin can do that." });
      expect(member.create).not.toHaveBeenCalled();
      expect(member.update).not.toHaveBeenCalled();
      expect(member.delete).not.toHaveBeenCalled();
    });
  }
});

describe("addMemberAction", () => {
  it("creates a user who must change the temporary password", async () => {
    const result = await addMemberAction({ name: "Sam", password: "temp-pass-12", role: "MEMBER" });
    expect(result).toEqual({ ok: true });
    expect(hash).toHaveBeenCalledWith("temp-pass-12", 12);
    expect(user.create).toHaveBeenCalledWith({
      data: { name: "Sam", email: "sam@moolah.local", passwordHash: "hashed", mustChangePassword: true },
    });
    expect(member.create).toHaveBeenCalledWith({
      data: { householdId: "h1", userId: "u2", role: "MEMBER" },
    });
  });

  it("rejects a name that is already taken", async () => {
    user.findUnique.mockResolvedValue({ id: "u9" } as never);
    const result = await addMemberAction({ name: "Sam", password: "temp-pass-12", role: "MEMBER" });
    expect(result).toEqual({ ok: false, error: "That name is already taken." });
    expect(user.create).not.toHaveBeenCalled();
  });

  it("refuses to create a second owner", async () => {
    const result = await addMemberAction({ name: "Sam", password: "temp-pass-12", role: "OWNER" as never });
    expect(result.ok).toBe(false);
    expect(user.create).not.toHaveBeenCalled();
  });

  it("rejects a short password", async () => {
    const result = await addMemberAction({ name: "Sam", password: "short", role: "MEMBER" });
    expect(result.ok).toBe(false);
    expect(user.create).not.toHaveBeenCalled();
  });

  it("is a no-op success in demo mode", async () => {
    demoMode.value = true;
    expect(await addMemberAction({ name: "Sam", password: "temp-pass-12", role: "MEMBER" })).toEqual({ ok: true });
    expect(user.create).not.toHaveBeenCalled();
  });
});

describe("removeMemberAction", () => {
  it("removes a member and their user record", async () => {
    const result = await removeMemberAction("m2");
    expect(result).toEqual({ ok: true });
    expect(user.delete).toHaveBeenCalledWith({ where: { id: "u2" } });
  });

  it("refuses to remove the household owner", async () => {
    member.findFirst.mockResolvedValue(memberRow({ userId: "u1", role: "OWNER" }));
    const result = await removeMemberAction("m1");
    expect(result).toEqual({
      ok: false,
      error: "Transfer ownership before removing the owner.",
    });
    expect(user.delete).not.toHaveBeenCalled();
  });

  it("refuses when the member belongs to another household", async () => {
    member.findFirst.mockResolvedValue(null);
    const result = await removeMemberAction("m2");
    expect(result).toEqual({ ok: false, error: "Member not found." });
  });
});

describe("setMemberRoleAction", () => {
  it("persists a role change", async () => {
    const result = await setMemberRoleAction("m2", "ADMIN");
    expect(result).toEqual({ ok: true });
    expect(member.update).toHaveBeenCalledWith({ where: { id: "m2" }, data: { role: "ADMIN" } });
  });

  it("refuses to demote the owner", async () => {
    member.findFirst.mockResolvedValue(memberRow({ userId: "u1", role: "OWNER" }));
    const result = await setMemberRoleAction("m1", "MEMBER");
    expect(result).toEqual({ ok: false, error: "Transfer ownership before changing the owner's role." });
    expect(member.update).not.toHaveBeenCalled();
  });

  it("refuses to create a second owner", async () => {
    const result = await setMemberRoleAction("m2", "OWNER" as never);
    expect(result.ok).toBe(false);
    expect(member.update).not.toHaveBeenCalled();
  });
});

describe("setMemberCapabilitiesAction", () => {
  it("persists grants and denials, dropping unknown capabilities", async () => {
    const result = await setMemberCapabilitiesAction("m2", ["MANAGE_RULES", "NOT_REAL"], ["VIEW_DEBT"]);
    expect(result).toEqual({ ok: true });
    expect(member.update).toHaveBeenCalledWith({
      where: { id: "m2" },
      data: { capabilities: ["MANAGE_RULES"], deniedCapabilities: ["VIEW_DEBT"] },
    });
  });

  it("refuses an admin, whose overrides are ignored anyway", async () => {
    member.findFirst.mockResolvedValue(memberRow({ role: "ADMIN" }));
    const result = await setMemberCapabilitiesAction("m2", ["MANAGE_RULES"], []);
    expect(result).toEqual({
      ok: false,
      error: "Admins already hold every permission. Change their role first.",
    });
    expect(member.update).not.toHaveBeenCalled();
  });
});

describe("transferOwnershipAction", () => {
  it("swaps the owner and both roles in one transaction", async () => {
    member.findFirst.mockResolvedValue(memberRow());
    const result = await transferOwnershipAction("m2");
    expect(result).toEqual({ ok: true });
    expect(household.update).toHaveBeenCalledWith({ where: { id: "h1" }, data: { ownerId: "u2" } });
    expect(member.update).toHaveBeenCalledWith({ where: { id: "m2" }, data: { role: "OWNER" } });
    expect(member.update).toHaveBeenCalledWith({
      where: { householdId_userId: { householdId: "h1", userId: "u1" } },
      data: { role: "ADMIN" },
    });
  });

  it("refuses when the caller is not the owner", async () => {
    adminMock.mockResolvedValue(ctx({ userId: "u3", role: "ADMIN" }));
    const result = await transferOwnershipAction("m2");
    expect(result).toEqual({ ok: false, error: "Only the current owner can transfer ownership." });
    expect(household.update).not.toHaveBeenCalled();
  });
});
