// GET /api/v1 — discovery root. Self-describes the read-only API so a consumer
// can find every endpoint and its query params without external docs. No auth:
// it exposes no account data, only the shape of the API. All data endpoints
// require an `Authorization: Bearer moolah_<token>` header.

import { apiJson, readOnlyMethods, API_VERSION } from "./_auth";

export const dynamic = "force-dynamic";

const endpoints = [
  {
    path: "/api/v1/summary",
    description: "Headline figures: net worth, safe-to-transfer, current-month budget, upcoming bills.",
    params: { tz: "IANA timezone to anchor 'today' (default UTC)" },
  },
  {
    path: "/api/v1/net-worth",
    description: "Assets, liabilities, net, and per-account balances. Optional history and forecast.",
    params: {
      range: "3m | 1y | all — include a daily history series",
      forecast: "1-24 — include an N-month net-worth projection",
      tz: "IANA timezone to anchor 'today' (default UTC)",
    },
  },
  {
    path: "/api/v1/accounts",
    description: "All non-archived accounts with balances.",
    params: {},
  },
  {
    path: "/api/v1/budget",
    description: "Budget vs. actual per category for a month.",
    params: {
      month: "YYYY-MM (default current month)",
      tz: "IANA timezone to anchor 'today' (default UTC)",
    },
  },
  {
    path: "/api/v1/upcoming",
    description: "Bills and income expected in the next N days.",
    params: {
      days: "1-90 (default 14)",
      tz: "IANA timezone to anchor 'today' (default UTC)",
    },
  },
];

export function GET() {
  return apiJson({
    name: "Moolah read-only API",
    version: API_VERSION,
    auth: "Authorization: Bearer moolah_<token> (generate in Settings)",
    endpoints,
  });
}

export const { POST, PUT, PATCH, DELETE } = readOnlyMethods;
