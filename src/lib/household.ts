import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action-result";
import { DEFAULT_CATEGORIES } from "./default-categories";

// Unambiguous alphabet (no 0/O/1/I/L) for human-friendly invite codes.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCode(): string {
  // Rejection sampling: a plain `byte % ALPHABET.length` biases toward the
  // start of the alphabet because 256 is not a multiple of 31. Discard bytes in
  // the unbalanced tail so every character is equally likely.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let s = "";
  while (s.length < 8) {
    for (const b of randomBytes(16)) {
      if (b >= limit) continue;
      s += ALPHABET[b % ALPHABET.length];
      if (s.length === 8) break;
    }
  }
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
  if (!household) throw new UserError("That invite code didn't match any household.");
  await prisma.user.update({ where: { id: userId }, data: { householdId: household.id } });
  return household;
}
