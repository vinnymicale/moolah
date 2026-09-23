// The password change every account can make for itself. Unlike the actions in
// household.ts this one is not admin-gated - it only ever touches the caller's
// own row - so the tests focus on verifying the current password and clearing
// the must-change flag.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

vi.mock("bcryptjs", () => ({
  hash: vi.fn(async () => "new-hash"),
  compare: vi.fn(async (plain: string, hashed: string) => hashed === `hash:${plain}`),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { changePasswordAction } from "./account";
import { prisma } from "@/lib/prisma";
import { hash } from "bcryptjs";
import { requireUser } from "@/lib/session";

const userMock = vi.mocked(requireUser);
const user = vi.mocked(prisma.user);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  userMock.mockResolvedValue({ userId: "u1" });
  user.findUnique.mockResolvedValue({ id: "u1", passwordHash: "hash:oldpass" } as never);
});

describe("changePasswordAction", () => {
  it("replaces the hash and clears the must-change flag", async () => {
    const result = await changePasswordAction({ current: "oldpass", next: "brandnewpass" });
    expect(result).toEqual({ ok: true });
    expect(hash).toHaveBeenCalledWith("brandnewpass", 12);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: "new-hash", mustChangePassword: false },
    });
  });

  it("rejects a wrong current password", async () => {
    const result = await changePasswordAction({ current: "guess", next: "brandnewpass" });
    expect(result).toEqual({ ok: false, error: "That is not your current password." });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("rejects a new password shorter than 8 characters", async () => {
    const result = await changePasswordAction({ current: "oldpass", next: "short" });
    expect(result.ok).toBe(false);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("is a no-op success in demo mode", async () => {
    demoMode.value = true;
    expect(await changePasswordAction({ current: "oldpass", next: "brandnewpass" })).toEqual({ ok: true });
    expect(userMock).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });

  it("errors when the account has no password to verify against", async () => {
    // A bypass-mode row has no hash, so there is nothing to compare and
    // nothing sensible to replace.
    user.findUnique.mockResolvedValue({ id: "u1", passwordHash: null } as never);
    const result = await changePasswordAction({ current: "oldpass", next: "brandnewpass" });
    expect(result).toEqual({ ok: false, error: "This account has no password set." });
    expect(user.update).not.toHaveBeenCalled();
  });
});
