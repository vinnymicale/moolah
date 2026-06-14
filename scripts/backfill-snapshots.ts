// One-time backfill so existing users have a net-worth starting point.
//
// Writes today's snapshot (current balance) for every non-archived account that
// has no snapshot for today yet. Safe to re-run: the (accountId, date) unique
// constraint makes it idempotent. After this lands, ongoing capture happens
// automatically on each Plaid sync (see src/lib/snapshots.ts).

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

function todayUTC(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main() {
  const date = todayUTC();
  const accounts = await p.financialAccount.findMany({
    where: { archived: false },
    select: { id: true, name: true, currentBalance: true },
  });
  let written = 0;
  for (const a of accounts) {
    await p.accountSnapshot.upsert({
      where: { accountId_date: { accountId: a.id, date } },
      create: { accountId: a.id, date, balance: a.currentBalance },
      update: { balance: a.currentBalance },
    });
    written++;
  }
  console.log(`Backfilled ${written} snapshot(s) for ${date.toISOString().slice(0, 10)}.`);
}

main().finally(() => p.$disconnect());
