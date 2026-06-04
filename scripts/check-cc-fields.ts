import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const accts = await p.financialAccount.findMany({
    where: { isAsset: false },
    select: { name: true, type: true, creditLimit: true, nextPaymentDueDate: true, lastStatementBalance: true, lastStatementDate: true, minimumPayment: true },
  });
  console.log(JSON.stringify(accts, null, 2));
}

main().finally(() => p.$disconnect());
