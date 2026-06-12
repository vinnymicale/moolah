/**
 * Seeds a demo user with categories, accounts, transactions, recurring
 * rules and balance snapshots so the UI is populated for local review.
 *
 *   npm run db:seed
 *
 * Idempotent: it wipes and recreates the demo user's data each run.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_CATEGORIES } from "../src/lib/default-categories";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Always use a fixed throwaway email for the demo account so that running
// db:seed never touches a real user's data.
const DEMO_EMAIL = "demo@example.com";

// Work relative to a fixed "today" derived from the system clock.
const today = new Date();
const Y = today.getUTCFullYear();
const M = today.getUTCMonth();
const day = (d: number, monthOffset = 0) => new Date(Date.UTC(Y, M + monthOffset, d));

async function main() {
  console.log(`Seeding demo user (login email: ${DEMO_EMAIL}) …`);

  // ── Demo user ────────────────────────────────────────────────────────────
  const demoUser = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: "Demo User" },
    create: { email: DEMO_EMAIL, name: "Demo User" },
  });

  // ── Wipe existing demo financial data (keep the user) ────────────────────
  await prisma.transaction.deleteMany({ where: { userId: demoUser.id } });
  await prisma.recurringRule.deleteMany({ where: { userId: demoUser.id } });
  await prisma.budget.deleteMany({ where: { userId: demoUser.id } });
  await prisma.accountSnapshot.deleteMany({
    where: { account: { userId: demoUser.id } },
  });
  await prisma.financialAccount.deleteMany({ where: { userId: demoUser.id } });
  await prisma.savingsGoal.deleteMany({ where: { userId: demoUser.id } });
  await prisma.category.deleteMany({ where: { userId: demoUser.id } });

  // ── Categories ───────────────────────────────────────────────────────────
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: demoUser.id, isSystem: true })),
  });
  const categories = await prisma.category.findMany({ where: { userId: demoUser.id } });
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;

  // ── Accounts ─────────────────────────────────────────────────────────────
  const checking = await prisma.financialAccount.create({
    data: { userId: demoUser.id, name: "Joint Checking", type: "CHECKING", institution: "Chase", currentBalance: 5240.5, isAsset: true, includeInCash: true, color: "#2563eb" },
  });
  const savings = await prisma.financialAccount.create({
    data: { userId: demoUser.id, name: "Emergency Savings", type: "SAVINGS", institution: "Ally", currentBalance: 18400, isAsset: true, includeInCash: true, color: "#0891b2" },
  });
  const creditCard = await prisma.financialAccount.create({
    data: {
      userId: demoUser.id, name: "Sapphire Card", type: "CREDIT_CARD", institution: "Chase",
      currentBalance: 1284.32, isAsset: false, includeInCash: false, color: "#dc2626",
      // Debt-payoff terms so the Debt page can build a plan.
      interestRate: 19.99, minimumPayment: 35, includeInDebtPlanner: true,
      // Statement / payment details (normally filled by Plaid) so the Accounts
      // page shows credit-utilisation, statement balance and the due date.
      creditLimit: 8000,
      lastStatementBalance: 1106.54,
      lastStatementDate: day(22, -1),
      lastPaymentAmount: 980,
      lastPaymentDate: day(18, -1),
      nextPaymentDueDate: day(18, 0),
      isOverdue: false,
    },
  });
  const retirement401k = await prisma.financialAccount.create({
    data: { userId: demoUser.id, name: "401(k)", type: "RETIREMENT", institution: "Fidelity", currentBalance: 142500, isAsset: true, includeInCash: false, color: "#7c3aed" },
  });
  const rothIra = await prisma.financialAccount.create({
    data: { userId: demoUser.id, name: "Roth IRA", type: "RETIREMENT", institution: "Vanguard", currentBalance: 38250, isAsset: true, includeInCash: false, color: "#9333ea" },
  });
  const car = await prisma.financialAccount.create({
    data: { userId: demoUser.id, name: "Honda CR-V", type: "VEHICLE", currentBalance: 24800, isAsset: true, includeInCash: false, color: "#0d9488" },
  });

  // ── Recurring rules ──────────────────────────────────────────────────────
  const rules = await Promise.all([
    prisma.recurringRule.create({ data: { userId: demoUser.id, accountId: checking.id, categoryId: cat("Salary"), type: "INCOME", amount: 2600, description: "Paycheck", frequency: "BIWEEKLY", interval: 1, startDate: day(2, -1) } }),
    prisma.recurringRule.create({ data: { userId: demoUser.id, accountId: checking.id, categoryId: cat("Rent / Mortgage"), type: "EXPENSE", amount: 2150, description: "Mortgage", frequency: "MONTHLY", dayOfMonth: 1, startDate: day(1, -2) } }),
    prisma.recurringRule.create({ data: { userId: demoUser.id, accountId: checking.id, categoryId: cat("Utilities"), type: "EXPENSE", amount: 180, description: "Electric & Gas", frequency: "MONTHLY", dayOfMonth: 12, startDate: day(12, -2) } }),
    prisma.recurringRule.create({ data: { userId: demoUser.id, accountId: creditCard.id, categoryId: cat("Subscriptions"), type: "EXPENSE", amount: 15.99, description: "Netflix", frequency: "MONTHLY", dayOfMonth: 8, startDate: day(8, -3) } }),
    prisma.recurringRule.create({ data: { userId: demoUser.id, accountId: creditCard.id, categoryId: cat("Subscriptions"), type: "EXPENSE", amount: 10.99, description: "Spotify", frequency: "MONTHLY", dayOfMonth: 20, startDate: day(20, -3) } }),
    prisma.recurringRule.create({ data: { userId: demoUser.id, accountId: checking.id, categoryId: cat("Savings / Investing"), type: "EXPENSE", amount: 500, description: "Auto-transfer to savings", frequency: "MONTHLY", dayOfMonth: 5, startDate: day(5, -3) } }),
  ]);

  // ── Concrete transactions for the current month ──────────────────────────
  const tx = (
    d: number, type: "INCOME" | "EXPENSE", amount: number, description: string,
    catName: string, accountId: string, cleared = true, recurringRuleId: string | null = null,
  ) => ({
    userId: demoUser.id,
    accountId,
    categoryId: cat(catName),
        type, amount, description, cleared,
    date: day(d),
    // Link realized occurrences to their rule so the calendar shows them once
    // (as paid) instead of also projecting the rule on the same day.
    recurringRuleId,
  });

  // Rule ids by creation order above, for linking realized occurrences.
  const [rulePaycheck, ruleMortgage, ruleElectric, ruleNetflix, ruleSpotify, ruleSavings] =
    rules.map((r) => r.id);

  await prisma.transaction.createMany({
    data: [
      // Recurring occurrences are linked to their rule (last arg) so the
      // calendar renders them once instead of also projecting the rule.
      tx(1, "EXPENSE", 2150, "Mortgage", "Rent / Mortgage", checking.id, true, ruleMortgage),
      tx(3, "EXPENSE", 86.42, "Costco run", "Groceries", creditCard.id),
      tx(4, "EXPENSE", 54.18, "Dinner – Tavola", "Dining Out", creditCard.id),
      tx(5, "EXPENSE", 500, "Auto-transfer to savings", "Savings / Investing", checking.id, true, ruleSavings),
      tx(6, "EXPENSE", 42.3, "Shell gas", "Gas / Fuel", creditCard.id),
      tx(8, "EXPENSE", 15.99, "Netflix", "Subscriptions", creditCard.id, true, ruleNetflix),
      tx(9, "EXPENSE", 121.74, "Whole Foods", "Groceries", creditCard.id),
      tx(11, "EXPENSE", 64.0, "Pharmacy", "Health", creditCard.id),
      tx(12, "EXPENSE", 180, "Electric & Gas", "Utilities", checking.id, true, ruleElectric),
      // Upcoming / expected items this month. Paydays land on the rule's
      // biweekly cadence (13th & 27th) and are linked so they aren't doubled.
      tx(13, "INCOME", 2600, "Paycheck", "Salary", checking.id, false, rulePaycheck),
      tx(27, "INCOME", 2600, "Paycheck", "Salary", checking.id, false, rulePaycheck),
      tx(20, "EXPENSE", 10.99, "Spotify", "Subscriptions", creditCard.id, false, ruleSpotify),
      tx(22, "EXPENSE", 95.0, "Date night", "Dining Out", creditCard.id, false),
    ],
  });

  // Some last-month history so trends/charts have data. The recurring ones are
  // linked to their rule so last month's calendar de-dupes too.
  await prisma.transaction.createMany({
    data: [
      tx(2, "INCOME", 2600, "Paycheck", "Salary", checking.id, true, rulePaycheck),
      tx(16, "INCOME", 2600, "Paycheck", "Salary", checking.id, true, rulePaycheck),
      tx(1, "EXPENSE", 2150, "Mortgage", "Rent / Mortgage", checking.id, true, ruleMortgage),
      tx(7, "EXPENSE", 410.55, "Groceries (month)", "Groceries", creditCard.id),
      tx(14, "EXPENSE", 220.0, "Dining (month)", "Dining Out", creditCard.id),
      tx(18, "EXPENSE", 175.25, "Utilities", "Utilities", checking.id),
      tx(21, "EXPENSE", 60.0, "Gas", "Gas / Fuel", creditCard.id),
    ].map((t) => ({ ...t, date: day(t.date.getUTCDate(), -1) })),
  });

  // A repeating charge the user never turned into a rule - the Recurring page's
  // detector (getRecurringSuggestions) spots it and suggests creating a rule.
  await prisma.transaction.createMany({
    data: [1, 2, 3, 4].map((k) => ({
      userId: demoUser.id,
      accountId: creditCard.id,
      categoryId: cat("Personal Care"),
            type: "EXPENSE" as const,
      amount: 24.99,
      description: "Planet Fitness",
      cleared: true,
      date: day(15, -k),
      recurringRuleId: null,
    })),
  });

  // ── Budgets for the current month ────────────────────────────────────────
  const monthStart = new Date(Date.UTC(Y, M, 1));
  await prisma.budget.createMany({
    data: [
      { userId: demoUser.id, categoryId: cat("Groceries"), month: monthStart, limit: 700 },
      { userId: demoUser.id, categoryId: cat("Dining Out"), month: monthStart, limit: 300 },
      { userId: demoUser.id, categoryId: cat("Gas / Fuel"), month: monthStart, limit: 200 },
      { userId: demoUser.id, categoryId: cat("Entertainment"), month: monthStart, limit: 150 },
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

  // ── Savings goals ────────────────────────────────────────────────────────
  await prisma.savingsGoal.createMany({
    data: [
      { userId: demoUser.id, name: "Emergency fund", targetAmount: 15000, currentAmount: 9200, color: "#16a34a", icon: "shield" },
      { userId: demoUser.id, name: "Hawaii vacation", targetAmount: 6000, currentAmount: 2400, color: "#0891b2", icon: "plane", targetDate: new Date(Date.UTC(Y, 11, 1)) },
      { userId: demoUser.id, name: "New car fund", targetAmount: 25000, currentAmount: 8500, color: "#7c3aed", icon: "car" },
      { userId: demoUser.id, name: "House down payment", targetAmount: 60000, currentAmount: 18000, color: "#2563eb", icon: "home" },
    ],
  });

  console.log("✓ Seed complete.");
  console.log(`  Sign in with dev login as: ${DEMO_EMAIL}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
