// GET /api/v1/net-worth — assets, liabilities, net, and per-account balances.

import { NextRequest } from "next/server";
import { requireApiUser, apiJson } from "../_auth";
import { getNetWorth } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;

  const nw = await getNetWorth(auth.userId);
  return apiJson({
    assets: nw.assets,
    liabilities: nw.liabilities,
    net: nw.net,
    accounts: nw.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: a.currentBalance,
      isAsset: a.isAsset,
      includeInNetWorth: a.includeInNetWorth,
    })),
  });
}
