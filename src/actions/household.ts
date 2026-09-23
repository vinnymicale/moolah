"use server";

// Membership management. Every action here is admin-only: these are the calls
// that hand out and take away access to the ledger, so they sit behind
// requireAdmin rather than a capability, and each one writes an audit entry.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/household";
import { recordAudit } from "@/lib/audit";
import { nameToEmail } from "@/lib/user-setup";
import { isCapability, type Capability, type HouseholdRoleName } from "@/lib/capabilities";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";

const addMemberSchema = z.object({
  name: z.string().min(1, "Name is required").max(60),
  password: z.string().min(8, "Password must be at least 8 characters"),
  // OWNER is deliberately absent: a household has exactly one owner and it
  // changes through transferOwnershipAction, never by creating a second one.
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
});

export type AddMemberInput = z.input<typeof addMemberSchema>;

function settingsPaths() {
  revalidatePath("/settings");
}

/** The membership plus the two relations every guard below needs. */
async function loadMember(memberId: string, householdId: string) {
  const member = await prisma.householdMember.findFirst({
    where: { id: memberId, householdId },
    include: { user: { select: { id: true, name: true } }, household: { select: { id: true, ownerId: true } } },
  });
  if (!member) throw new UserError("Member not found.");
  return member;
}

export async function addMemberAction(input: AddMemberInput): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId, userId } = await requireAdmin();
    const data = addMemberSchema.parse(input);

    const email = nameToEmail(data.name);
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken) throw new UserError("That name is already taken.");

    // The admin picks the first password, so the new member is forced to
    // replace it before they can use the app.
    const passwordHash = await hash(data.password, 12);
    const created = await prisma.user.create({
      data: { name: data.name, email, passwordHash, mustChangePassword: true },
    });
    await prisma.householdMember.create({
      data: { householdId, userId: created.id, role: data.role },
    });

    await recordAudit({
      householdId,
      actorId: userId,
      action: "member.add",
      entityType: "HouseholdMember",
      entityId: created.id,
      summary: `${data.name} as ${data.role}`,
    });
    settingsPaths();
  });
}

export async function removeMemberAction(memberId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId, userId } = await requireAdmin();
    const member = await loadMember(memberId, householdId);
    if (member.userId === member.household.ownerId) {
      throw new UserError("Transfer ownership before removing the owner.");
    }

    await prisma.householdMember.delete({ where: { id: member.id } });
    // A member belongs to exactly one household, so removing them from it
    // leaves an account that can sign in and see nothing. Delete it too.
    await prisma.user.delete({ where: { id: member.userId } });

    await recordAudit({
      householdId,
      actorId: userId,
      action: "member.remove",
      entityType: "HouseholdMember",
      entityId: member.userId,
      summary: member.user.name ?? member.userId,
    });
    settingsPaths();
  });
}

export async function setMemberRoleAction(memberId: string, role: HouseholdRoleName): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId, userId } = await requireAdmin();
    if (role === "OWNER") throw new UserError("Use transfer ownership to change the owner.");
    const parsed = z.enum(["ADMIN", "MEMBER", "VIEWER"]).parse(role);
    const member = await loadMember(memberId, householdId);
    if (member.userId === member.household.ownerId) {
      throw new UserError("Transfer ownership before changing the owner's role.");
    }

    await prisma.householdMember.update({ where: { id: member.id }, data: { role: parsed } });
    await recordAudit({
      householdId,
      actorId: userId,
      action: "member.role",
      entityType: "HouseholdMember",
      entityId: member.userId,
      summary: `${member.user.name ?? member.userId} to ${parsed}`,
    });
    settingsPaths();
  });
}

export async function setMemberCapabilitiesAction(
  memberId: string,
  granted: string[],
  denied: string[],
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId, userId } = await requireAdmin();
    const member = await loadMember(memberId, householdId);
    // Admins resolve to every capability regardless of these arrays, so saving
    // overrides for one would show a permission editor that does nothing.
    if (member.role === "OWNER" || member.role === "ADMIN") {
      throw new UserError("Admins already hold every permission. Change their role first.");
    }

    const capabilities = granted.filter(isCapability) as Capability[];
    const deniedCapabilities = denied.filter(isCapability) as Capability[];
    await prisma.householdMember.update({
      where: { id: member.id },
      data: { capabilities, deniedCapabilities },
    });

    await recordAudit({
      householdId,
      actorId: userId,
      action: "member.capabilities",
      entityType: "HouseholdMember",
      entityId: member.userId,
      summary: `${member.user.name ?? member.userId}: ${capabilities.length} granted, ${deniedCapabilities.length} denied`,
    });
    settingsPaths();
  });
}

export async function transferOwnershipAction(memberId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId, userId } = await requireAdmin();
    const member = await loadMember(memberId, householdId);
    // An admin can do everything else here, but handing the household to
    // someone else is the owner's call alone.
    if (member.household.ownerId !== userId) {
      throw new UserError("Only the current owner can transfer ownership.");
    }
    if (member.userId === userId) throw new UserError("They already own this household.");

    // One transaction so the household can never have an ownerId pointing at a
    // member whose role says otherwise.
    await prisma.$transaction(async (tx) => {
      await tx.household.update({ where: { id: householdId }, data: { ownerId: member.userId } });
      await tx.householdMember.update({ where: { id: member.id }, data: { role: "OWNER" } });
      await tx.householdMember.update({
        where: { householdId_userId: { householdId, userId } },
        data: { role: "ADMIN" },
      });
    });

    await recordAudit({
      householdId,
      actorId: userId,
      action: "member.transferOwnership",
      entityType: "Household",
      entityId: householdId,
      summary: `to ${member.user.name ?? member.userId}`,
    });
    settingsPaths();
  });
}
