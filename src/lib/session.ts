import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function getSession() {
  return auth();
}

export interface UserContext {
  userId: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

/**
 * Require a signed-in user; redirect to sign-in otherwise. When AUTH_BYPASS=true,
 * unauthenticated requests redirect to the auto-signin route which transparently
 * creates the local user and signs in - no login screen shown.
 */
export async function requireUser(): Promise<UserContext> {
  const session = await auth();
  const bypass = process.env.AUTH_BYPASS === "true";
  if (!session?.user?.id) redirect(bypass ? "/api/auth/auto-signin" : "/signin");
  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };
}
