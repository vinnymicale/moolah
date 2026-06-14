// Bearer-token auth for the read-only data API (/api/v1).
//
// Tokens are high-entropy random strings shown once at generation time. We
// persist only a keyed hash on the User, so a database leak doesn't expose
// working tokens. Because the token is random and full-entropy there's nothing
// to brute-force, so a slow password hash isn't needed; but we key the hash
// with the app secret (HMAC) so that a DB dump alone - without the secret - is
// useless for forging a stored hash. The hash stays deterministic, preserving
// the O(1) indexed lookup by apiTokenHash.

import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TOKEN_PREFIX = "moolah_";

/** Secret keying the token HMAC. Reuses the same secret as at-rest encryption. */
function tokenSecret(): string {
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY or AUTH_SECRET must be set to hash API tokens.");
  }
  return secret;
}

/** Generate a new raw API token. Shown to the user once; never stored as-is. */
export function generateApiToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("base64url");
}

/** Keyed (HMAC-SHA256) hash of a raw token, as stored in User.apiTokenHash. */
export function hashApiToken(raw: string): string {
  return createHmac("sha256", tokenSecret()).update(raw).digest("hex");
}

/** Pull the bearer token out of an Authorization header, or null. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

export interface ApiUser {
  userId: string;
}

/**
 * Resolve the user for a read-only API request from its Authorization header.
 * Returns null when the header is missing or the token doesn't match any user.
 *
 * The lookup is a single indexed equality on the SHA-256 hash. We don't add a
 * constant-time compare on top: the column is unique and we look it up by the
 * full hash, so the query already succeeds or fails as a whole - there's no
 * per-character match progress to leak, and the timing of a hash-table/B-tree
 * hit isn't a function of the secret in a way an attacker can exploit.
 */
export async function authenticateApiRequest(authHeader: string | null): Promise<ApiUser | null> {
  const raw = bearerFromHeader(authHeader);
  if (!raw) return null;
  const hash = hashApiToken(raw);

  const user = await prisma.user.findUnique({
    where: { apiTokenHash: hash },
    select: { id: true },
  });
  if (!user) return null;

  return { userId: user.id };
}
