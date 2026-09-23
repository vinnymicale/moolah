/**
 * Provides the demo household context without requiring real authentication.
 * Only used when DEMO_MODE=true. Looks up the seeded demo user by its fixed
 * email and resolves its household, so it works even if the DB was re-seeded.
 */
import { prisma } from "@/lib/prisma";
import { nameToEmail } from "@/lib/user-setup";

// Derived the same way the seed derives it. A literal here went stale once when
// sign-in moved to name-derived identities, and every demo page silently fell
// back to an empty household.
export const DEMO_NAME = "Demo User";
export const DEMO_EMAIL = nameToEmail(DEMO_NAME);

let cachedId: string | null = null;

export async function getDemoHouseholdId(): Promise<string | null> {
  if (cachedId) return cachedId;
  try {
    const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
    if (!user) return null;
    const membership = await prisma.householdMember.findUnique({
      where: { userId: user.id },
      select: { householdId: true },
    });
    if (membership) cachedId = membership.householdId;
    return membership?.householdId ?? null;
  } catch {
    return null;
  }
}
