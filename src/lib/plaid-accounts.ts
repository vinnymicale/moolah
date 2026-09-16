// Reconciles the accounts Plaid reports for an Item against our own
// FinancialAccount / PlaidLinkedAccount rows.
//
// Used both on first link and when the user re-opens Account Select to
// authorize an account that was left out the first time. Any Plaid account we
// haven't seen gets a fresh FinancialAccount; ones we already track are reused
// so their history survives.

import type { PlaidApi } from "plaid";
import { prisma } from "@/lib/prisma";

const LIABILITY_SUBTYPES = new Set(["credit card", "auto loan", "student loan", "mortgage", "line of credit", "home equity line of credit"]);
const LIABILITY_TYPES = new Set(["credit", "loan"]);

export function isAsset(type: string, subtype: string | null | undefined): boolean {
  const sub = (subtype ?? "").toLowerCase();
  if (LIABILITY_SUBTYPES.has(sub)) return false;
  if (LIABILITY_TYPES.has(type.toLowerCase())) return false;
  return true;
}

export function toAccountType(type: string, subtype: string | null | undefined): string {
  const sub = (subtype ?? "").toLowerCase();
  const t = type.toLowerCase();
  if (sub === "checking") return "CHECKING";
  if (sub === "savings") return "SAVINGS";
  if (sub === "credit card") return "CREDIT_CARD";
  if (sub.includes("401") || sub.includes("ira") || sub === "403b") return "RETIREMENT";
  if (t === "investment" || sub === "brokerage" || sub === "mutual fund") return "INVESTMENT";
  if (t === "loan" || sub.includes("loan") || sub === "mortgage") return "LOAN";
  if (t === "credit") return "CREDIT_CARD";
  return "CHECKING";
}

export interface SyncAccountsResult {
  /** Accounts newly authorized since the last time we looked at this Item. */
  added: number;
  /** Accounts already linked, whose balances were refreshed in place. */
  updated: number;
}

/**
 * Pull the Item's current account list and make our rows match it.
 *
 * `plaidItemRowId` is our own PlaidItem.id, not Plaid's item_id.
 */
export async function syncPlaidAccounts(args: {
  plaidClient: PlaidApi;
  accessToken: string;
  plaidItemRowId: string;
  userId: string;
  institutionName: string | null;
}): Promise<SyncAccountsResult> {
  const { plaidClient, accessToken, plaidItemRowId, userId, institutionName } = args;

  const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });

  let added = 0;
  let updated = 0;

  for (const acct of accountsRes.data.accounts) {
    const accountType = toAccountType(acct.type, acct.subtype);
    const asset = isAsset(acct.type, acct.subtype);
    const balance = acct.balances.current ?? 0;
    const isChecking = acct.type === "depository";

    // Check whether this Plaid account was previously linked.
    const existing = await prisma.plaidLinkedAccount.findUnique({
      where: { plaidAccountId: acct.account_id },
      select: { financialAccountId: true, financialAccount: { select: { archived: true } } },
    });

    let financialAccountId: string;

    if (existing?.financialAccountId) {
      // Reuse the existing FinancialAccount so historical data is preserved.
      financialAccountId = existing.financialAccountId;
      // An archived account is hidden from the accounts page, so re-authorizing
      // it at the bank has to bring it back - otherwise the user re-adds it in
      // Plaid, we quietly update a row they cannot see, and nothing appears.
      const wasArchived = existing.financialAccount?.archived ?? false;
      await prisma.financialAccount.update({
        where: { id: financialAccountId },
        data: { currentBalance: balance, institution: institutionName, archived: false },
      });
      // Coming back from archived is an add from the user's point of view.
      if (wasArchived) added++;
      else updated++;
    } else {
      const finAcct = await prisma.financialAccount.create({
        data: {
          userId,
          name: acct.name,
          type: accountType as never,
          institution: institutionName,
          currentBalance: balance,
          isAsset: asset,
          includeInCash: isChecking,
          color: asset ? "#2563eb" : "#dc2626",
        },
      });
      financialAccountId = finAcct.id;
      added++;
    }

    await prisma.plaidLinkedAccount.upsert({
      where: { plaidAccountId: acct.account_id },
      create: {
        plaidItemId: plaidItemRowId,
        plaidAccountId: acct.account_id,
        financialAccountId,
        name: acct.name,
        officialName: acct.official_name,
        mask: acct.mask,
        plaidType: acct.type,
        plaidSubtype: acct.subtype,
        currentBalance: acct.balances.current,
        availableBalance: acct.balances.available,
      },
      update: {
        plaidItemId: plaidItemRowId,
        name: acct.name,
        officialName: acct.official_name,
        mask: acct.mask,
        currentBalance: acct.balances.current,
        availableBalance: acct.balances.available,
      },
    });
  }

  return { added, updated };
}
