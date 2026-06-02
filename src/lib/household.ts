import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CATEGORIES } from "./default-categories";

// Unambiguous alphabet (no 0/O/1/I/L) for human-friendly invite codes.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

async function uniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateInviteCode();
    const existing = await prisma.household.findUnique({ where: { inviteCode: code } });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique invite code");
}

/** Create a household, seed default categories, and attach the user to it. */
export async function createHouseholdForUser(userId: string, name: string) {
  const inviteCode = await uniqueInviteCode();
  const household = await prisma.household.create({
    data: { name: name.trim() || "Our Household", inviteCode },
  });
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, householdId: household.id, isSystem: true })),
  });
  await prisma.user.update({ where: { id: userId }, data: { householdId: household.id } });
  return household;
}

/** Attach a user to an existing household via its invite code. */
export async function joinHouseholdByCode(userId: string, code: string) {
  const inviteCode = code.trim().toUpperCase();
  const household = await prisma.household.findUnique({ where: { inviteCode } });
  if (!household) throw new Error("That invite code didn't match any household.");
  await prisma.user.update({ where: { id: userId }, data: { householdId: household.id } });
  return household;
}
