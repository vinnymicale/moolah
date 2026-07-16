import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { ensureDefaultCategories, nameToEmail } from "@/lib/user-setup";

// Attempts per account name per window before sign-in/sign-up is refused.
// Auth.js authorize() has no request IP, so the key is the normalized name -
// enough to stop online password guessing against a known account.
const SIGNIN_MAX_ATTEMPTS = 10;
const SIGNIN_WINDOW_MS = 60_000;

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/**
 * Verify (sign-in) or create (sign-up) a local user by name + password.
 * Returns the user on success, null on any failure - same contract as
 * Auth.js authorize().
 *
 * Sign-up is rejected when the name already belongs to an account with a
 * password, so an existing user can't be overwritten. A user row without a
 * password (e.g. created by an earlier version) is claimed by sign-up instead
 * of duplicated.
 */
export async function authorizeLocalUser(
  rawName: string,
  password: string,
  isSignup: boolean,
): Promise<AuthorizedUser | null> {
  const name = rawName.trim();
  if (!name) return null;

  const email = nameToEmail(name);

  // Auto-signin (AUTH_BYPASS) authenticates the local user without a password.
  // Bypass mode already lets any visitor in via /api/auth/auto-signin, so this
  // grants nothing the mode doesn't grant - and it stays scoped to that one name.
  const isBypassUser =
    process.env.AUTH_BYPASS === "true" &&
    name.toLowerCase() === (process.env.LOCAL_USER_NAME?.trim() || "local").toLowerCase();
  if (isBypassUser && !isSignup) {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { email, name } });
      await ensureDefaultCategories(user.id);
    }
    return { id: user.id, email: user.email, name: user.name, image: user.image };
  }

  if (!password) return null;

  if (!checkRateLimit(`signin:${email}`, SIGNIN_MAX_ATTEMPTS, SIGNIN_WINDOW_MS).allowed) {
    return null;
  }

  if (isSignup) {
    const existing = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
    if (existing?.passwordHash) return null;
    const passwordHash = await hash(password, 12);
    const user = existing
      ? await prisma.user.update({ where: { email }, data: { passwordHash, name } })
      : await prisma.user.create({ data: { email, name, passwordHash } });
    await ensureDefaultCategories(user.id);
    return { id: user.id, email: user.email, name: user.name, image: user.image };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) return null;
  if (!(await compare(password, user.passwordHash))) return null;
  return { id: user.id, email: user.email, name: user.name, image: user.image };
}
