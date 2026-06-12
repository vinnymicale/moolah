import { prisma } from "@/lib/prisma";
import { DEFAULT_CATEGORIES } from "./default-categories";

/**
 * Seed the default category set for a user who has none yet. Called when a
 * user record is first created (OAuth, dev login, or auto-signin), and safe to
 * call again - it does nothing once the user has any categories.
 */
export async function ensureDefaultCategories(userId: string) {
  const existing = await prisma.category.count({ where: { userId } });
  if (existing > 0) return;
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId, isSystem: true })),
  });
}
