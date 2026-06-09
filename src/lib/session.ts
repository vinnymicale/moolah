import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function getSession() {
  return auth();
}

/** Require a signed-in user; redirect to sign-in (or auto-signin) otherwise. */
export async function requireUser() {
  const session = await auth();
  const bypass = process.env.AUTH_BYPASS === "true";
  if (!session?.user?.id) redirect(bypass ? "/api/auth/auto-signin" : "/signin");
  return session.user;
}

export interface HouseholdContext {
  userId: string;
  householdId: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

/**
 * Require a signed-in user who belongs to a household. When AUTH_BYPASS=true,
 * unauthenticated requests redirect to the auto-signin route which transparently
 * creates the local user + household and signs in - no login screen shown.
 */
export async function requireHousehold(): Promise<HouseholdContext> {
  const session = await auth();
  const bypass = process.env.AUTH_BYPASS === "true";
  if (!session?.user?.id) redirect(bypass ? "/api/auth/auto-signin" : "/signin");
  if (!session.user.householdId) redirect(bypass ? "/api/auth/auto-signin" : "/welcome");
  return {
    userId: session.user.id,
    householdId: session.user.householdId,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };
}
