import { prisma } from "@/lib/prisma";
import { DEFAULT_CATEGORIES } from "./default-categories";

/** Converts a display name to a stable local email used as the Auth.js identity. */
export function nameToEmail(name: string): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, ".")}@moolah.local`;
}

/**
 * Seed the default category set for a user who has none yet. Called when a
 * user record is first created (sign-up or auto-signin), and safe to call
 * again - it does nothing once the user has any categories.
 */
export async function ensureDefaultCategories(userId: string) {
  const existing = await prisma.category.count({ where: { userId } });
  if (existing > 0) return;
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId, isSystem: true })),
  });
}
