// Bearer-token auth for the read-only data API (/api/v1).
//
// A token has the shape `moolah_<selector>.<verifier>`, both halves random and
// shown once at generation. The two halves play different roles:
//
//   - selector: a non-secret random id. We store it verbatim under a unique
//     index, so authenticating is an O(1) lookup by selector - no scanning all
//     users to find a matching hash.
//   - verifier: the actual secret. We store only a slow (scrypt) hash of it.
//     Even though the verifier is full-entropy, hashing it with a KDF means a
//     leaked DB can't be brute-forced back to a working token, and it keeps
//     static analysis (CodeQL) from flagging a fast hash on a credential.
//
// Per request we do one indexed selector lookup plus exactly one scrypt verify
// - constant work, independent of the number of users.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TOKEN_PREFIX = "moolah_";
const SELECTOR_BYTES = 12;
const VERIFIER_BYTES = 24;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEYLEN = 32;

/** Generate a new raw API token. Shown to the user once; never stored as-is. */
export function generateApiToken(): string {
  const selector = randomBytes(SELECTOR_BYTES).toString("base64url");
  const verifier = randomBytes(VERIFIER_BYTES).toString("base64url");
  return `${TOKEN_PREFIX}${selector}.${verifier}`;
}

/** Split a raw token into its selector/verifier halves, or null if malformed. */
export function parseApiToken(raw: string): { selector: string; verifier: string } | null {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const body = raw.slice(TOKEN_PREFIX.length);
  const dot = body.indexOf(".");
  if (dot <= 0 || dot === body.length - 1) return null;
  return { selector: body.slice(0, dot), verifier: body.slice(dot + 1) };
}

/**
 * Slow (scrypt) hash of a token's verifier half, stored in
 * User.apiTokenVerifierHash. Format is `salt:derivedKey`, both hex; the salt is
 * embedded so verifyApiTokenVerifier is self-contained.
 */
export function hashApiTokenVerifier(verifier: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = scryptSync(verifier, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Constant-time check of a verifier against a stored `salt:derivedKey` hash. */
export function verifyApiTokenVerifier(verifier: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(verifier, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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
 * Returns null when the header is missing, the token is malformed, or it
 * doesn't match any user.
 *
 * The selector is looked up under a unique index (O(1)); the verifier is then
 * checked with a slow, constant-time scrypt compare. We always run the verify
 * against either the stored hash or a throwaway one when no user matches, so a
 * valid-but-unknown selector and an invalid verifier take the same time.
 */
export async function authenticateApiRequest(authHeader: string | null): Promise<ApiUser | null> {
  const raw = bearerFromHeader(authHeader);
  if (!raw) return null;
  const parsed = parseApiToken(raw);
  if (!parsed) return null;

  const user = await prisma.user.findUnique({
    where: { apiTokenSelector: parsed.selector },
    select: { id: true, apiTokenVerifierHash: true },
  });
  const stored = user?.apiTokenVerifierHash ?? DUMMY_VERIFIER_HASH;

  if (!verifyApiTokenVerifier(parsed.verifier, stored)) return null;
  return user ? { userId: user.id } : null;
}

// Burned on requests whose selector matches no user, so those take the same
// scrypt time as a real verify instead of returning early.
const DUMMY_VERIFIER_HASH = hashApiTokenVerifier(randomBytes(VERIFIER_BYTES).toString("base64url"));

/**
 * Non-secret rate-limit key for a raw token: its selector. The selector is
 * already a random id, so it's safe to use directly without a slow hash, and
 * distinct tokens get distinct buckets.
 */
export function rateLimitKeyForToken(raw: string): string | null {
  const parsed = parseApiToken(raw);
  return parsed ? parsed.selector : null;
}
