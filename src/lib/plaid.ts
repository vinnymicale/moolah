// Plaid API client singleton.
// Credentials come from env; the client is only ever used server-side.
// The client is created lazily on first method call so the app builds and
// boots without Plaid credentials (Next.js imports this module while
// collecting page data at build time, where no env vars are set).

import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";

let client: PlaidApi | null = null;

function createClient(): PlaidApi {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    throw new Error("Missing PLAID_CLIENT_ID or PLAID_SECRET env vars.");
  }

  const env = (process.env.PLAID_ENV ?? "development") as keyof typeof PlaidEnvironments;
  if (!(env in PlaidEnvironments)) {
    throw new Error(`Unknown PLAID_ENV "${env}". Must be sandbox, development, or production.`);
  }

  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
        "PLAID-SECRET": process.env.PLAID_SECRET,
      },
    },
  });
  return new PlaidApi(config);
}

export const plaidClient: PlaidApi = new Proxy({} as PlaidApi, {
  get(_target, prop) {
    client ??= createClient();
    const value = client[prop as keyof PlaidApi];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// Products and countries we request during Link.
export const PLAID_PRODUCTS: Products[] = [Products.Transactions, Products.Liabilities];
export const PLAID_COUNTRY_CODES: CountryCode[] = [CountryCode.Us];
