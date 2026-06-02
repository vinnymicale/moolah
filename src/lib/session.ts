import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function getSession() {
  return auth();
}

/** Require a signed-in user; redirect to sign-in otherwise. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
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
 * Require a signed-in user who belongs to a household. Redirects to /signin if
 * not authenticated, or /welcome if they still need to create/join one.
 */
export async function requireHousehold(): Promise<HouseholdContext> {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!session.user.householdId) redirect("/welcome");
  return {
    userId: session.user.id,
    householdId: session.user.householdId,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };
}
