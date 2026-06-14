// GET /api/v1/accounts — all non-archived accounts with balances.

import { NextRequest } from "next/server";
import { requireApiUser, apiJson } from "../_auth";
import { getAccounts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;

  const accounts = await getAccounts(auth.userId);
  return apiJson({
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution,
      balance: a.currentBalance,
      isAsset: a.isAsset,
      creditLimit: a.creditLimit,
      nextPaymentDueDate: a.nextPaymentDueDate,
    })),
  });
}
