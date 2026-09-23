// Plaid API client, resolved per household.
//
// Each household stores its own Plaid credentials (Settings → Plaid bank sync),
// set by an admin, so separate households link banks against separate Plaid
// developer accounts. The PLAID_* env vars act as an instance-wide fallback for
// households without stored keys. Everything here is server-side only; clients are built lazily
// per request so the app builds and boots without any Plaid credentials.

import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";

interface PlaidCreds {
  clientId: string;
  secret: string;
  env: string;
}

/** The credentials a household's Plaid calls should use: its keys, else env. */
async function resolveCreds(householdId: string): Promise<PlaidCreds | null> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { plaidClientId: true, plaidSecret: true, plaidEnv: true },
  });
  if (household?.plaidClientId && household.plaidSecret) {
    return {
      clientId: household.plaidClientId,
      secret: decryptSecret(household.plaidSecret),
      env: household.plaidEnv || "sandbox",
    };
  }
  if (process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET) {
    return {
      clientId: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      env: process.env.PLAID_ENV || "sandbox",
    };
  }
  return null;
}

/** Whether the household can use Plaid features (own keys or env fallback). */
export async function hasPlaidConfig(householdId: string): Promise<boolean> {
  return (await resolveCreds(householdId)) !== null;
}

/** Build a Plaid client for this household. Throws if no credentials are available. */
export async function getPlaidClient(householdId: string): Promise<PlaidApi> {
  const creds = await resolveCreds(householdId);
  if (!creds) {
    throw new Error("Plaid is not configured. Add your keys in Settings → Plaid bank sync.");
  }
  if (!(creds.env in PlaidEnvironments)) {
    throw new Error(`Unknown Plaid environment "${creds.env}". Must be sandbox or production.`);
  }
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[creds.env as keyof typeof PlaidEnvironments],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": creds.clientId,
          "PLAID-SECRET": creds.secret,
        },
      },
    }),
  );
}

// Products and countries we request during Link.
export const PLAID_PRODUCTS: Products[] = [Products.Transactions, Products.Liabilities];
export const PLAID_COUNTRY_CODES: CountryCode[] = [CountryCode.Us];
