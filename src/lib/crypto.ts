// Symmetric encryption for secrets stored in the database (AI API keys, Plaid
// access tokens).
//
// AES-256-GCM with a key derived from ENCRYPTION_KEY (falling back to
// AUTH_SECRET so existing single-secret deployments keep working). Values are
// stored as "enc:v1:<iv>:<ciphertext+tag>" (base64); anything not in that
// format is treated as legacy plaintext so existing rows keep working until
// re-saved.
//
// IMPORTANT: the encryption key must stay stable. Rotating ENCRYPTION_KEY (or
// AUTH_SECRET, when that's what's keying encryption) makes every previously
// stored secret undecryptable - they'd have to be re-entered. Set a dedicated
// ENCRYPTION_KEY so the session secret can be rotated independently of secrets
// at rest.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY or AUTH_SECRET must be set to encrypt stored secrets.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${PREFIX}${iv.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext row
  const [ivB64, dataB64] = stored.slice(PREFIX.length).split(":");
  const iv = Buffer.from(ivB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const ciphertext = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
