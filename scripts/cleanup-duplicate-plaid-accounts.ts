/**
 * One-time cleanup: removes duplicate FinancialAccounts and stale PlaidItems
 * that were created when re-linking accounts via the full Plaid Link flow
 * (instead of update mode). Safe to run multiple times — idempotent.
 *
 * Strategy:
 *   1. Find FinancialAccounts that share the same (householdId, name).
 *   2. Keep the OLDEST account (has transaction history).
 *   3. Re-point any PlaidLinkedAccounts from newer duplicates to the keeper.
 *   4. Delete the newer duplicate FinancialAccounts.
 *   5. Delete older PlaidItems whose item_id is now superseded by a newer one
 *      for the same institution within the same household.
 *
 * Run with:  npx tsx scripts/cleanup-duplicate-plaid-accounts.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const p = new PrismaClient({ adapter });

async function main() {
  // ── Step 1: find duplicate FinancialAccounts ────────────────────────────────

  const allAccounts = await p.financialAccount.findMany({
    select: { id: true, householdId: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by (householdId, name)
  const groups = new Map<string, typeof allAccounts>();
  for (const acct of allAccounts) {
    const key = `${acct.householdId}::${acct.name}`;
    const group = groups.get(key) ?? [];
    group.push(acct);
    groups.set(key, group);
  }

  let reassigned = 0;
  let deleted = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    // First entry is the oldest (keeper); rest are duplicates.
    const [keeper, ...duplicates] = group;
    console.log(`\nDuplicate group: "${key.split("::")[1]}" (${group.length} copies)`);
    console.log(`  Keeper  : ${keeper.id} (created ${keeper.createdAt.toISOString()})`);

    for (const dup of duplicates) {
      console.log(`  Deleting: ${dup.id} (created ${dup.createdAt.toISOString()})`);

      // Re-point any PlaidLinkedAccounts that reference this duplicate to the keeper.
      const { count } = await p.plaidLinkedAccount.updateMany({
        where: { financialAccountId: dup.id },
        data: { financialAccountId: keeper.id },
      });
      if (count > 0) {
        console.log(`    Re-pointed ${count} PlaidLinkedAccount(s) → keeper`);
        reassigned += count;
      }

      // Re-point any transactions from the duplicate account to the keeper.
      const { count: txCount } = await p.transaction.updateMany({
        where: { accountId: dup.id },
        data: { accountId: keeper.id },
      });
      if (txCount > 0) {
        console.log(`    Moved ${txCount} transaction(s) → keeper`);
      }

      // Delete the duplicate FinancialAccount.
      await p.financialAccount.delete({ where: { id: dup.id } });
      deleted++;
    }
  }

  console.log(`\nFinancialAccount cleanup: ${deleted} duplicate(s) removed, ${reassigned} link(s) reassigned.`);

  // ── Step 2: remove stale PlaidItems ────────────────────────────────────────
  // For each household+institution pair, keep only the newest PlaidItem.

  const allItems = await p.plaidItem.findMany({
    select: { id: true, householdId: true, institutionId: true, institutionName: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Group by (householdId, institutionId). Fall back to institutionName if id is null.
  const itemGroups = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const key = `${item.householdId}::${item.institutionId ?? item.institutionName ?? item.id}`;
    const group = itemGroups.get(key) ?? [];
    group.push(item);
    itemGroups.set(key, group);
  }

  let itemsRemoved = 0;

  for (const [key, group] of itemGroups) {
    if (group.length < 2) continue;

    // Keep the newest (last in asc-sorted list); delete the rest.
    const stale = group.slice(0, -1);
    const keeper = group[group.length - 1];
    console.log(`\nStale PlaidItems for "${key.split("::")[1]}":`);
    console.log(`  Active  : ${keeper.id} (created ${keeper.createdAt.toISOString()})`);

    for (const item of stale) {
      console.log(`  Removing: ${item.id} (created ${item.createdAt.toISOString()})`);
      // Cascade deletes PlaidLinkedAccounts on this item.
      await p.plaidItem.delete({ where: { id: item.id } });
      itemsRemoved++;
    }
  }

  console.log(`\nPlaidItem cleanup: ${itemsRemoved} stale item(s) removed.`);
  console.log("\nDone.");
}

main().finally(() => p.$disconnect());
