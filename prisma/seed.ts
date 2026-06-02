/**
 * Seeds a demo household with categories, accounts, transactions, recurring
 * rules and balance snapshots so the UI is populated for local review.
 *
 *   npm run db:seed
 *
 * Idempotent: it wipes and recreates the demo household's data each run.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_CATEGORIES } from "../src/lib/default-categories";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEMO_INVITE = "DEMO-2026";
// Always use a fixed throwaway email for the demo account so that running
// db:seed never touches a real user's household assignment.
const DEMO_EMAIL = "demo@example.com";

// Work relative to a fixed "today" derived from the system clock.
const today = new Date();
const Y = today.getUTCFullYear();
const M = today.getUTCMonth();
const day = (d: number, monthOffset = 0) => new Date(Date.UTC(Y, M + monthOffset, d));

async function main() {
  console.log(`Seeding demo household (login email: ${DEMO_EMAIL}) …`);

  // ── Household + demo user ────────────────────────────────────────────────
  const household = await prisma.household.upsert({
    where: { inviteCode: DEMO_INVITE },
    update: { name: "Our Household" },
    create: { name: "Our Household", inviteCode: DEMO_INVITE },
  });

  // Only set householdId on the demo user if it has none yet, so re-running
  // the seed can never steal a real user away from their own household.
  const existingDemo = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: existingDemo?.householdId ? {} : { householdId: household.id },
    create: { email: DEMO_EMAIL, name: "Demo User", householdId: household.id },
  });
  const demoUser = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });

  // ── Wipe existing demo financial data (keep users) ───────────────────────
  await prisma.transaction.deleteMany({ where: { householdId: household.id } });
  await prisma.recurringRule.deleteMany({ where: { householdId: household.id } });
  await prisma.budget.deleteMany({ where: { householdId: household.id } });
  await prisma.accountSnapshot.deleteMany({
    where: { account: { householdId: household.id } },
  });
  await prisma.financialAccount.deleteMany({ where: { householdId: household.id } });
  await prisma.category.deleteMany({ where: { householdId: household.id } });

  // ── Categories ───────────────────────────────────────────────────────────
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, householdId: household.id, isSystem: true })),
  });
  const categories = await prisma.category.findMany({ where: { householdId: household.id } });
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;

  // ── Accounts ─────────────────────────────────────────────────────────────
  const checking = await prisma.financialAccount.create({
    data: { householdId: household.id, name: "Joint Checking", type: "CHECKING", institution: "Chase", currentBalance: 5240.5, isAsset: true, includeInCash: true, color: "#2563eb" },
  });
  const savings = await prisma.financialAccount.create({
    data: { householdId: household.id, name: "Emergency Savings", type: "SAVINGS", institution: "Ally", currentBalance: 18400, isAsset: true, includeInCash: true, color: "#0891b2" },
  });
  const creditCard = await prisma.financialAccount.create({
    data: { householdId: household.id, name: "Sapphire Card", type: "CREDIT_CARD", institution: "Chase", currentBalance: 1284.32, isAsset: false, includeInCash: false, color: "#dc2626" },
  });
  const retirement401k = await prisma.financialAccount.create({
    data: { householdId: household.id, name: "401(k)", type: "RETIREMENT", institution: "Fidelity", currentBalance: 142500, isAsset: true, includeInCash: false, color: "#7c3aed" },
  });
  const rothIra = await prisma.financialAccount.create({
    data: { householdId: household.id, name: "Roth IRA", type: "RETIREMENT", institution: "Vanguard", currentBalance: 38250, isAsset: true, includeInCash: false, color: "#9333ea" },
  });
  const car = await prisma.financialAccount.create({
    data: { householdId: household.id, name: "Honda CR-V", type: "VEHICLE", currentBalance: 24800, isAsset: true, includeInCash: false, color: "#0d9488" },
  });

  // ── Recurring rules ──────────────────────────────────────────────────────
  const rules = await Promise.all([
    prisma.recurringRule.create({ data: { householdId: household.id, accountId: checking.id, categoryId: cat("Salary"), type: "INCOME", amount: 2600, description: "Paycheck", frequency: "BIWEEKLY", interval: 1, startDate: day(2, -1) } }),
    prisma.recurringRule.create({ data: { householdId: household.id, accountId: checking.id, categoryId: cat("Rent / Mortgage"), type: "EXPENSE", amount: 2150, description: "Mortgage", frequency: "MONTHLY", dayOfMonth: 1, startDate: day(1, -2) } }),
    prisma.recurringRule.create({ data: { householdId: household.id, accountId: checking.id, categoryId: cat("Utilities"), type: "EXPENSE", amount: 180, description: "Electric & Gas", frequency: "MONTHLY", dayOfMonth: 12, startDate: day(12, -2) } }),
    prisma.recurringRule.create({ data: { householdId: household.id, accountId: creditCard.id, categoryId: cat("Subscriptions"), type: "EXPENSE", amount: 15.99, description: "Netflix", frequency: "MONTHLY", dayOfMonth: 8, startDate: day(8, -3) } }),
    prisma.recurringRule.create({ data: { householdId: household.id, accountId: creditCard.id, categoryId: cat("Subscriptions"), type: "EXPENSE", amount: 10.99, description: "Spotify", frequency: "MONTHLY", dayOfMonth: 20, startDate: day(20, -3) } }),
    prisma.recurringRule.create({ data: { householdId: household.id, accountId: checking.id, categoryId: cat("Savings / Investing"), type: "EXPENSE", amount: 500, description: "Auto-transfer to savings", frequency: "MONTHLY", dayOfMonth: 5, startDate: day(5, -3) } }),
  ]);

  // ── Concrete transactions for the current month ──────────────────────────
  const tx = (
    d: number, type: "INCOME" | "EXPENSE", amount: number, description: string,
    catName: string, accountId: string, cleared = true,
  ) => ({
    householdId: household.id,
    accountId,
    categoryId: cat(catName),
    createdById: demoUser?.id,
    type, amount, description, cleared,
    date: day(d),
  });

  await prisma.transaction.createMany({
    data: [
      tx(2, "INCOME", 2600, "Paycheck", "Salary", checking.id),
      tx(1, "EXPENSE", 2150, "Mortgage", "Rent / Mortgage", checking.id),
      tx(3, "EXPENSE", 86.42, "Costco run", "Groceries", creditCard.id),
      tx(4, "EXPENSE", 54.18, "Dinner – Tavola", "Dining Out", creditCard.id),
      tx(5, "EXPENSE", 500, "Auto-transfer to savings", "Savings / Investing", checking.id),
      tx(6, "EXPENSE", 42.3, "Shell gas", "Gas / Fuel", creditCard.id),
      tx(8, "EXPENSE", 15.99, "Netflix", "Subscriptions", creditCard.id),
      tx(9, "EXPENSE", 121.74, "Whole Foods", "Groceries", creditCard.id),
      tx(11, "EXPENSE", 64.0, "Pharmacy", "Health", creditCard.id),
      tx(12, "EXPENSE", 180, "Electric & Gas", "Utilities", checking.id),
      // A couple of future / expected items this month.
      tx(16, "INCOME", 2600, "Paycheck", "Salary", checking.id, false),
      tx(20, "EXPENSE", 10.99, "Spotify", "Subscriptions", creditCard.id, false),
      tx(22, "EXPENSE", 95.0, "Date night", "Dining Out", creditCard.id, false),
    ],
  });

  // Some last-month history so trends/charts have data.
  await prisma.transaction.createMany({
    data: [
      tx(2, "INCOME", 2600, "Paycheck", "Salary", checking.id),
      tx(16, "INCOME", 2600, "Paycheck", "Salary", checking.id),
      tx(1, "EXPENSE", 2150, "Mortgage", "Rent / Mortgage", checking.id),
      tx(7, "EXPENSE", 410.55, "Groceries (month)", "Groceries", creditCard.id),
      tx(14, "EXPENSE", 220.0, "Dining (month)", "Dining Out", creditCard.id),
      tx(18, "EXPENSE", 175.25, "Utilities", "Utilities", checking.id),
      tx(21, "EXPENSE", 60.0, "Gas", "Gas / Fuel", creditCard.id),
    ].map((t) => ({ ...t, date: day(t.date.getUTCDate(), -1) })),
  });

  // ── Budgets for the current month ────────────────────────────────────────
  const monthStart = new Date(Date.UTC(Y, M, 1));
  await prisma.budget.createMany({
    data: [
      { householdId: household.id, categoryId: cat("Groceries"), month: monthStart, limit: 700 },
      { householdId: household.id, categoryId: cat("Dining Out"), month: monthStart, limit: 300 },
      { householdId: household.id, categoryId: cat("Gas / Fuel"), month: monthStart, limit: 200 },
      { householdId: household.id, categoryId: cat("Entertainment"), month: monthStart, limit: 150 },
    ],
  });

  // ── Net-worth snapshots (last 6 months) for trend charts ─────────────────
  const snapshotAccounts: Array<[string, number]> = [
    [retirement401k.id, 142500],
    [rothIra.id, 38250],
    [car.id, 24800],
    [savings.id, 18400],
  ];
  for (const [accountId, current] of snapshotAccounts) {
    for (let i = 6; i >= 0; i--) {
      // Drift older values down a bit so the net-worth line trends upward.
      const drift = accountId === car.id ? 1 + i * 0.012 : 1 - i * 0.018;
      await prisma.accountSnapshot.create({
        data: { accountId, date: day(1, -i), balance: Math.round(current * drift * 100) / 100 },
      });
    }
  }

  void rules;
  console.log("✓ Seed complete.");
  console.log(`  Household: ${household.name}  (invite code: ${DEMO_INVITE})`);
  console.log(`  Sign in with dev login as: ${DEMO_EMAIL}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
