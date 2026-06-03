import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const p = new PrismaClient({ adapter });

async function main() {
  const items = await p.plaidItem.findMany({ select: { id: true, lastSyncedAt: true } });
  console.log(`Found ${items.length} Plaid item(s):`, items);

  const result = await p.plaidItem.updateMany({ data: { cursor: null } });
  console.log(`Reset cursor for ${result.count} item(s). Next sync will replay from the beginning.`);
}

main().finally(() => p.$disconnect());
