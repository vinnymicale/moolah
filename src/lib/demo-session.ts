/**
 * Provides the demo household context without requiring real authentication.
 * Only used when DEMO_MODE=true. Looks up the household by the seeded invite
 * code so it works even if the DB was re-seeded (the invite code is stable).
 */
import { prisma } from "@/lib/prisma";

const DEMO_INVITE = "DEMO-2026";

let cachedId: string | null = null;

export async function getDemoHouseholdId(): Promise<string | null> {
  if (cachedId) return cachedId;
  try {
    const h = await prisma.household.findUnique({ where: { inviteCode: DEMO_INVITE }, select: { id: true } });
    if (h) cachedId = h.id;
    return h?.id ?? null;
  } catch {
    return null;
  }
}
