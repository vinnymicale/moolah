/**
 * Provides the demo user context without requiring real authentication.
 * Only used when DEMO_MODE=true. Looks up the seeded demo user by its fixed
 * email so it works even if the DB was re-seeded.
 */
import { prisma } from "@/lib/prisma";

const DEMO_EMAIL = "demo@example.com";

let cachedId: string | null = null;

export async function getDemoUserId(): Promise<string | null> {
  if (cachedId) return cachedId;
  try {
    const u = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
    if (u) cachedId = u.id;
    return u?.id ?? null;
  } catch {
    return null;
  }
}
