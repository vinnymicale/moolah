// First-run setup: read the current credential status and write the .env file
// from the in-app setup screen, so users don't have to edit .env by hand.
//
// This only ever runs locally — the API route and the sign-in screen both gate
// it behind isLocalHost() — because it writes secrets to disk and would be
// dangerous to expose on a deployment.

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const ENV_PATH = resolve(process.cwd(), ".env");
const EXAMPLE_PATH = resolve(process.cwd(), ".env.example");
const PLACEHOLDER_SECRET = "generate-with-npx-auth-secret";

export interface SetupStatus {
  googleConfigured: boolean;
  plaidConfigured: boolean;
  devLoginEnabled: boolean;
  authSecretSet: boolean;
  plaidEnv: string;
  allowedEmails: string;
}

export interface SetupValues {
  authGoogleId?: string;
  authGoogleSecret?: string;
  plaidClientId?: string;
  plaidSecret?: string;
  plaidEnv?: string;
  allowedEmails?: string;
  disableDevLogin?: boolean;
}

/** True for requests whose Host is the local machine (no LAN / no deployment). */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/** Current credential configuration, read from the process environment. */
export function getSetupStatus(): SetupStatus {
  return {
    googleConfigured: !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
    plaidConfigured: !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    devLoginEnabled: process.env.AUTH_DEV_LOGIN === "true",
    authSecretSet: !!process.env.AUTH_SECRET && process.env.AUTH_SECRET !== PLACEHOLDER_SECRET,
    plaidEnv: process.env.PLAID_ENV || "sandbox",
    allowedEmails: process.env.ALLOWED_EMAILS || "",
  };
}

/** Set or append a KEY="value" line, preserving the rest of the file. */
function setKey(content: string, key: string, value: string): string {
  const line = `${key}=${JSON.stringify(value)}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  return `${content.replace(/\s*$/, "")}\n${line}\n`;
}

/**
 * Update the .env file with the provided values. Only non-empty fields are
 * written (blank = keep what's there). Generates a real AUTH_SECRET if the
 * current one is missing or the placeholder. Returns the .env path written.
 */
export async function writeEnvConfig(values: SetupValues): Promise<string> {
  let content = "";
  try {
    content = await fs.readFile(ENV_PATH, "utf8");
  } catch {
    try { content = await fs.readFile(EXAMPLE_PATH, "utf8"); } catch { content = ""; }
  }

  // Ensure a real secret so sessions are secure.
  if (!/^AUTH_SECRET=/m.test(content) || new RegExp(`AUTH_SECRET="?${PLACEHOLDER_SECRET}"?`).test(content)) {
    content = setKey(content, "AUTH_SECRET", randomBytes(33).toString("base64"));
  }

  const apply = (key: string, v?: string) => {
    if (v != null && v.trim() !== "") content = setKey(content, key, v.trim());
  };
  apply("AUTH_GOOGLE_ID", values.authGoogleId);
  apply("AUTH_GOOGLE_SECRET", values.authGoogleSecret);
  apply("PLAID_CLIENT_ID", values.plaidClientId);
  apply("PLAID_SECRET", values.plaidSecret);
  apply("PLAID_ENV", values.plaidEnv);
  // Allow-list may legitimately be cleared, so write it whenever provided.
  if (values.allowedEmails != null) content = setKey(content, "ALLOWED_EMAILS", values.allowedEmails.trim());
  if (values.disableDevLogin) content = setKey(content, "AUTH_DEV_LOGIN", "false");

  await fs.writeFile(ENV_PATH, content, "utf8");
  return ENV_PATH;
}
