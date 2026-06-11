/**
 * One-time cleanup: removes pending Plaid transactions that were superseded by
 * a posted transaction but never deleted, because Plaid's `removed` event for
 * the pending row was missed. The ongoing fix lives in plaid-sync.ts, which now
 * reconciles via pending_transaction_id; this script clears the dupes that
 * already exist in the database.
 *
 * Strategy:
 *   1. Load all Plaid transactions that are still pending (cleared = false).
 *   2. For each, look for a posted (cleared = true) Plaid transaction in the
 *      same account with the same amount and type, dated within 5 days.
 *   3. If one exists, the pending row is a duplicate of the settled charge and
 *      is deleted.
 *
 * Dry run by default. Pass --apply to actually delete.
 *
 * Run with:  npx tsx scripts/cleanup-duplicate-pending-transactions.ts [--apply]
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const p = new PrismaClient({ adapter });

const apply = process.argv.includes("--apply");
const DAY = 86_400_000;
const WINDOW_DAYS = 5;

async function main() {
  const pending = await p.transaction.findMany({
    where: { plaidTransactionId: { not: null }, cleared: false },
    select: { id: true, householdId: true, accountId: true, type: true, amount: true, date: true, description: true },
    orderBy: { date: "asc" },
  });

  let removed = 0;

  for (const pend of pending) {
    const lo = new Date(pend.date.getTime() - WINDOW_DAYS * DAY);
    const hi = new Date(pend.date.getTime() + WINDOW_DAYS * DAY);

    const posted = await p.transaction.findFirst({
      where: {
        plaidTransactionId: { not: null },
        cleared: true,
        householdId: pend.householdId,
        accountId: pend.accountId,
        type: pend.type,
        amount: pend.amount,
        date: { gte: lo, lte: hi },
      },
      select: { id: true, date: true, description: true },
    });

    if (!posted) continue;

    console.log(
      `${apply ? "Deleting" : "Would delete"} pending ${pend.id} "${pend.description}" ` +
        `(${pend.amount}, ${pend.date.toISOString().slice(0, 10)}) — superseded by posted ` +
        `${posted.id} "${posted.description}" (${posted.date.toISOString().slice(0, 10)})`,
    );

    if (apply) await p.transaction.delete({ where: { id: pend.id } });
    removed++;
  }

  console.log(
    `\n${apply ? "Removed" : "Found"} ${removed} duplicate pending transaction(s).` +
      (apply ? "" : " Re-run with --apply to delete them."),
  );
}

main().finally(() => p.$disconnect());
