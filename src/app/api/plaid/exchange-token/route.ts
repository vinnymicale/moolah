// Exchanges a Plaid public_token for a permanent access_token, creates the
// PlaidItem and PlaidLinkedAccount rows, auto-creates a matching
// FinancialAccount for each Plaid account, and kicks off the first sync.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { plaidClient } from "@/lib/plaid";
import { syncPlaidItem } from "@/lib/plaid-sync";

const LIABILITY_SUBTYPES = new Set(["credit card", "auto loan", "student loan", "mortgage", "line of credit", "home equity line of credit"]);
const LIABILITY_TYPES = new Set(["credit", "loan"]);

function isAsset(type: string, subtype: string | null | undefined): boolean {
  const sub = (subtype ?? "").toLowerCase();
  if (LIABILITY_SUBTYPES.has(sub)) return false;
  if (LIABILITY_TYPES.has(type.toLowerCase())) return false;
  return true;
}

function toAccountType(type: string, subtype: string | null | undefined): string {
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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.householdId) return NextResponse.json({ error: "No household" }, { status: 403 });

  const { public_token } = (await req.json()) as { public_token: string };
  if (!public_token) return NextResponse.json({ error: "Missing public_token" }, { status: 400 });

  try {
    // Exchange the short-lived public token for a permanent access token.
    const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeRes.data;

    // Fetch institution info.
    const itemRes = await plaidClient.itemGet({ access_token });
    const institutionId = itemRes.data.item.institution_id ?? null;
    let institutionName: string | null = null;
    if (institutionId) {
      try {
        const instRes = await plaidClient.institutionsGetById({ institution_id: institutionId, country_codes: ["US" as never] });
        institutionName = instRes.data.institution.name;
      } catch {
        // Non-fatal — institution name is cosmetic.
      }
    }

    // Fetch the accounts attached to this item.
    const accountsRes = await plaidClient.accountsGet({ access_token });

    // Upsert the PlaidItem — update mode re-links return the same item_id.
    const plaidItem = await prisma.plaidItem.upsert({
      where: { itemId: item_id },
      create: {
        householdId: user.householdId,
        accessToken: access_token,
        itemId: item_id,
        institutionId,
        institutionName,
      },
      update: {
        accessToken: access_token,
        institutionId,
        institutionName,
        error: null,
      },
    });

    // For each Plaid account: upsert the link row and reuse any existing
    // FinancialAccount so we don't create duplicates on re-link.
    for (const acct of accountsRes.data.accounts) {
      const accountType = toAccountType(acct.type, acct.subtype);
      const asset = isAsset(acct.type, acct.subtype);
      const balance = acct.balances.current ?? 0;
      const isChecking = acct.type === "depository";

      // Check whether this Plaid account was previously linked.
      const existing = await prisma.plaidLinkedAccount.findUnique({
        where: { plaidAccountId: acct.account_id },
        select: { financialAccountId: true },
      });

      let financialAccountId: string;

      if (existing?.financialAccountId) {
        // Reuse the existing FinancialAccount so historical data is preserved.
        financialAccountId = existing.financialAccountId;
        await prisma.financialAccount.update({
          where: { id: financialAccountId },
          data: { currentBalance: balance, institution: institutionName },
        });
      } else {
        const finAcct = await prisma.financialAccount.create({
          data: {
            householdId: user.householdId,
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
      }

      await prisma.plaidLinkedAccount.upsert({
        where: { plaidAccountId: acct.account_id },
        create: {
          plaidItemId: plaidItem.id,
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
          plaidItemId: plaidItem.id,
          name: acct.name,
          officialName: acct.official_name,
          mask: acct.mask,
          currentBalance: acct.balances.current,
          availableBalance: acct.balances.available,
        },
      });
    }

    // First sync — pull all available transactions.
    const syncResult = await syncPlaidItem(plaidItem.id);

    return NextResponse.json({ ok: true, institutionName, ...syncResult });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Plaid error";
    console.error("Plaid exchange-token error:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
