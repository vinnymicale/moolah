/**
 * Static demo dataset used when DEMO_MODE=true.
 * Dates are computed relative to the current month at module load time so the
 * demo always looks "live" regardless of when it is visited.
 *
 * All IDs are short stable strings — no UUIDs needed since this data is
 * never persisted and never references a real database.
 */

import type {
  AccountDTO, CategoryDTO, TransactionDTO, RecurringDTO,
  BudgetLineDTO, SavingsGoalDTO, SnapshotDTO, TagDTO,
} from "@/lib/queries";
import type {
  ChannelDTO, NotificationDTO, RuleDTO,
} from "@/lib/queries/notifications";
import type { RecurringSuggestion } from "@/lib/recurring-suggestions";
import type { BudgetSuggestionsDTO } from "@/lib/budget-suggestions";

// ---------------------------------------------------------------------------
// Date helpers (UTC)
// ---------------------------------------------------------------------------

function day(d: number, monthOffset = 0): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + monthOffset;
  const date = new Date(Date.UTC(year, month, d));
  return date.toISOString().slice(0, 10);
}

function monthStart(monthOffset = 0): string {
  return day(1, monthOffset);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const DEMO_CATEGORIES: CategoryDTO[] = [
  { id: "cat-salary", name: "Salary", kind: "INCOME", color: "#16a34a", icon: "briefcase", parentId: null },
  { id: "cat-bonus", name: "Bonus", kind: "INCOME", color: "#22c55e", icon: "gift", parentId: null },
  { id: "cat-interest", name: "Interest", kind: "INCOME", color: "#10b981", icon: "percent", parentId: null },
  { id: "cat-invest-income", name: "Investment Income", kind: "INCOME", color: "#059669", icon: "trending-up", parentId: null },
  { id: "cat-refund", name: "Refund", kind: "INCOME", color: "#34d399", icon: "rotate-ccw", parentId: null },
  { id: "cat-other-income", name: "Other Income", kind: "INCOME", color: "#6ee7b7", icon: "plus-circle", parentId: null },
  { id: "cat-mortgage", name: "Rent / Mortgage", kind: "EXPENSE", color: "#dc2626", icon: "home", parentId: null },
  { id: "cat-utilities", name: "Utilities", kind: "EXPENSE", color: "#ea580c", icon: "zap", parentId: null },
  { id: "cat-internet", name: "Internet / Phone", kind: "EXPENSE", color: "#f97316", icon: "wifi", parentId: null },
  { id: "cat-home-maint", name: "Home Maintenance", kind: "EXPENSE", color: "#b45309", icon: "wrench", parentId: null },
  { id: "cat-groceries", name: "Groceries", kind: "EXPENSE", color: "#65a30d", icon: "shopping-cart", parentId: null },
  { id: "cat-dining", name: "Dining Out", kind: "EXPENSE", color: "#d97706", icon: "utensils", parentId: null },
  { id: "cat-transport", name: "Transportation", kind: "EXPENSE", color: "#0891b2", icon: "car", parentId: null },
  { id: "cat-gas", name: "Gas / Fuel", kind: "EXPENSE", color: "#0e7490", icon: "fuel", parentId: null },
  { id: "cat-shopping", name: "Shopping", kind: "EXPENSE", color: "#c026d3", icon: "shopping-bag", parentId: null },
  { id: "cat-health", name: "Health", kind: "EXPENSE", color: "#e11d48", icon: "heart-pulse", parentId: null },
  { id: "cat-insurance", name: "Insurance", kind: "EXPENSE", color: "#9333ea", icon: "shield", parentId: null },
  { id: "cat-entertainment", name: "Entertainment", kind: "EXPENSE", color: "#7c3aed", icon: "clapperboard", parentId: null },
  { id: "cat-subscriptions", name: "Subscriptions", kind: "EXPENSE", color: "#8b5cf6", icon: "repeat", parentId: null },
  { id: "cat-travel", name: "Travel", kind: "EXPENSE", color: "#2563eb", icon: "plane", parentId: null },
  { id: "cat-personal-care", name: "Personal Care", kind: "EXPENSE", color: "#db2777", icon: "sparkles", parentId: null },
  { id: "cat-gifts", name: "Gifts / Donations", kind: "EXPENSE", color: "#f43f5e", icon: "gift", parentId: null },
  { id: "cat-childcare", name: "Childcare", kind: "EXPENSE", color: "#0d9488", icon: "baby", parentId: null },
  { id: "cat-education", name: "Education", kind: "EXPENSE", color: "#4f46e5", icon: "graduation-cap", parentId: null },
  { id: "cat-debt", name: "Debt Payment", kind: "EXPENSE", color: "#be123c", icon: "credit-card", parentId: null },
  { id: "cat-savings", name: "Savings / Investing", kind: "EXPENSE", color: "#15803d", icon: "piggy-bank", parentId: null },
  { id: "cat-taxes", name: "Taxes", kind: "EXPENSE", color: "#991b1b", icon: "landmark", parentId: null },
  { id: "cat-fees", name: "Fees", kind: "EXPENSE", color: "#a16207", icon: "receipt", parentId: null },
  { id: "cat-other-expense", name: "Other Expense", kind: "EXPENSE", color: "#64748b", icon: "tag", parentId: null },
];

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const DEMO_ACCOUNTS: AccountDTO[] = [
  {
    id: "acct-checking",
    name: "Joint Checking",
    type: "CHECKING",
    institution: "Chase",
    currentBalance: 5240.5,
    isAsset: true,
    includeInCash: true,
    includeInNetWorth: true,
    includeInDebtPlanner: false,
    color: "#2563eb",
    archived: false,
    interestRate: null,
    minimumPayment: null,
    creditLimit: null,
    lastStatementBalance: null,
    lastStatementDate: null,
    lastPaymentAmount: null,
    lastPaymentDate: null,
    nextPaymentDueDate: null,
    isOverdue: null,
  },
  {
    id: "acct-savings",
    name: "Emergency Savings",
    type: "SAVINGS",
    institution: "Ally",
    currentBalance: 18400,
    isAsset: true,
    includeInCash: true,
    includeInNetWorth: true,
    includeInDebtPlanner: false,
    color: "#0891b2",
    archived: false,
    interestRate: null,
    minimumPayment: null,
    creditLimit: null,
    lastStatementBalance: null,
    lastStatementDate: null,
    lastPaymentAmount: null,
    lastPaymentDate: null,
    nextPaymentDueDate: null,
    isOverdue: null,
  },
  {
    id: "acct-cc",
    name: "Sapphire Card",
    type: "CREDIT_CARD",
    institution: "Chase",
    currentBalance: 1284.32,
    isAsset: false,
    includeInCash: false,
    includeInNetWorth: true,
    includeInDebtPlanner: true,
    color: "#dc2626",
    archived: false,
    interestRate: 19.99,
    minimumPayment: 35,
    creditLimit: 8000,
    lastStatementBalance: 1106.54,
    lastStatementDate: day(22, -1),
    lastPaymentAmount: 980,
    lastPaymentDate: day(18, -1),
    nextPaymentDueDate: day(18),
    isOverdue: false,
  },
  {
    id: "acct-401k",
    name: "401(k)",
    type: "RETIREMENT",
    institution: "Fidelity",
    currentBalance: 142500,
    isAsset: true,
    includeInCash: false,
    includeInNetWorth: true,
    includeInDebtPlanner: false,
    color: "#7c3aed",
    archived: false,
    interestRate: null,
    minimumPayment: null,
    creditLimit: null,
    lastStatementBalance: null,
    lastStatementDate: null,
    lastPaymentAmount: null,
    lastPaymentDate: null,
    nextPaymentDueDate: null,
    isOverdue: null,
  },
  {
    id: "acct-roth",
    name: "Roth IRA",
    type: "RETIREMENT",
    institution: "Vanguard",
    currentBalance: 38250,
    isAsset: true,
    includeInCash: false,
    includeInNetWorth: true,
    includeInDebtPlanner: false,
    color: "#9333ea",
    archived: false,
    interestRate: null,
    minimumPayment: null,
    creditLimit: null,
    lastStatementBalance: null,
    lastStatementDate: null,
    lastPaymentAmount: null,
    lastPaymentDate: null,
    nextPaymentDueDate: null,
    isOverdue: null,
  },
  {
    id: "acct-car",
    name: "Honda CR-V",
    type: "VEHICLE",
    institution: null,
    currentBalance: 24800,
    isAsset: true,
    includeInCash: false,
    includeInNetWorth: true,
    includeInDebtPlanner: false,
    color: "#0d9488",
    archived: false,
    interestRate: null,
    minimumPayment: null,
    creditLimit: null,
    lastStatementBalance: null,
    lastStatementDate: null,
    lastPaymentAmount: null,
    lastPaymentDate: null,
    nextPaymentDueDate: null,
    isOverdue: null,
  },
];

// ---------------------------------------------------------------------------
// Recurring rules
// ---------------------------------------------------------------------------

export const DEMO_RECURRING: RecurringDTO[] = [
  {
    id: "rec-paycheck",
    type: "INCOME",
    amount: 2600,
    description: "Paycheck",
    note: null,
    accountId: "acct-checking",
    categoryId: "cat-salary",
    frequency: "BIWEEKLY",
    interval: 1,
    dayOfMonth: null,
    weekday: null,
    startDate: day(2, -1),
    endDate: null,
  },
  {
    id: "rec-mortgage",
    type: "EXPENSE",
    amount: 2150,
    description: "Mortgage",
    note: null,
    accountId: "acct-checking",
    categoryId: "cat-mortgage",
    frequency: "MONTHLY",
    interval: 1,
    dayOfMonth: 1,
    weekday: null,
    startDate: day(1, -2),
    endDate: null,
  },
  {
    id: "rec-electric",
    type: "EXPENSE",
    amount: 180,
    description: "Electric & Gas",
    note: null,
    accountId: "acct-checking",
    categoryId: "cat-utilities",
    frequency: "MONTHLY",
    interval: 1,
    dayOfMonth: 12,
    weekday: null,
    startDate: day(12, -2),
    endDate: null,
  },
  {
    id: "rec-netflix",
    type: "EXPENSE",
    amount: 15.99,
    description: "Netflix",
    note: null,
    accountId: "acct-cc",
    categoryId: "cat-subscriptions",
    frequency: "MONTHLY",
    interval: 1,
    dayOfMonth: 8,
    weekday: null,
    startDate: day(8, -3),
    endDate: null,
  },
  {
    id: "rec-spotify",
    type: "EXPENSE",
    amount: 10.99,
    description: "Spotify",
    note: null,
    accountId: "acct-cc",
    categoryId: "cat-subscriptions",
    frequency: "MONTHLY",
    interval: 1,
    dayOfMonth: 20,
    weekday: null,
    startDate: day(20, -3),
    endDate: null,
  },
  {
    id: "rec-savings-transfer",
    type: "EXPENSE",
    amount: 500,
    description: "Auto-transfer to savings",
    note: null,
    accountId: "acct-checking",
    categoryId: "cat-savings",
    frequency: "MONTHLY",
    interval: 1,
    dayOfMonth: 5,
    weekday: null,
    startDate: day(5, -3),
    endDate: null,
  },
];

// ---------------------------------------------------------------------------
// Transactions (current month + last month)
// ---------------------------------------------------------------------------

function txn(
  id: string,
  d: number,
  type: "INCOME" | "EXPENSE",
  amount: number,
  description: string,
  categoryId: string,
  accountId: string,
  cleared = true,
  recurringRuleId: string | null = null,
  monthOffset = 0,
): TransactionDTO {
  return {
    id,
    type,
    amount,
    date: day(d, monthOffset),
    description,
    note: null,
    accountId,
    categoryId,
    cleared,
    isTransfer: false,
    effectiveTransfer: false,
    recurringRuleId,
    plaidTransactionId: null,
    splits: [],
    tags: [],
    attachments: [],
  };
}

const TAG_VACATION = { id: "tag-vacation", name: "vacation 2026", color: "#0891b2" };
const TAG_REIMBURSABLE = { id: "tag-reimbursable", name: "reimbursable", color: "#d97706" };

export const DEMO_TRANSACTIONS: TransactionDTO[] = [
  // Current month — cleared
  txn("tx-01", 1, "EXPENSE", 2150, "Mortgage", "cat-mortgage", "acct-checking", true, "rec-mortgage"),
  // A split charge: part groceries, part household shopping.
  {
    ...txn("tx-02", 3, "EXPENSE", 86.42, "Costco run", "", "acct-cc"),
    categoryId: null,
    splits: [
      { categoryId: "cat-groceries", amount: 56.42 },
      { categoryId: "cat-shopping", amount: 30 },
    ],
  },
  { ...txn("tx-03", 4, "EXPENSE", 54.18, "Dinner – Tavola", "cat-dining", "acct-cc"), tags: [TAG_VACATION] },
  txn("tx-04", 5, "EXPENSE", 500, "Auto-transfer to savings", "cat-savings", "acct-checking", true, "rec-savings-transfer"),
  txn("tx-05", 6, "EXPENSE", 42.3, "Shell gas", "cat-gas", "acct-cc"),
  txn("tx-06", 8, "EXPENSE", 15.99, "Netflix", "cat-subscriptions", "acct-cc", true, "rec-netflix"),
  { ...txn("tx-07", 9, "EXPENSE", 121.74, "Whole Foods", "cat-groceries", "acct-cc"), tags: [TAG_VACATION] },
  { ...txn("tx-08", 11, "EXPENSE", 64.0, "Pharmacy", "cat-health", "acct-cc"), tags: [TAG_REIMBURSABLE] },
  txn("tx-09", 12, "EXPENSE", 180, "Electric & Gas", "cat-utilities", "acct-checking", true, "rec-electric"),
  // Current month — upcoming / uncleared
  txn("tx-10", 13, "INCOME", 2600, "Paycheck", "cat-salary", "acct-checking", false, "rec-paycheck"),
  txn("tx-11", 20, "EXPENSE", 10.99, "Spotify", "cat-subscriptions", "acct-cc", false, "rec-spotify"),
  txn("tx-12", 22, "EXPENSE", 95.0, "Date night", "cat-dining", "acct-cc", false),
  txn("tx-13", 27, "INCOME", 2600, "Paycheck", "cat-salary", "acct-checking", false, "rec-paycheck"),
  // Last month
  txn("lm-01", 2, "INCOME", 2600, "Paycheck", "cat-salary", "acct-checking", true, "rec-paycheck", -1),
  txn("lm-02", 16, "INCOME", 2600, "Paycheck", "cat-salary", "acct-checking", true, "rec-paycheck", -1),
  txn("lm-03", 1, "EXPENSE", 2150, "Mortgage", "cat-mortgage", "acct-checking", true, "rec-mortgage", -1),
  txn("lm-04", 7, "EXPENSE", 410.55, "Groceries (month)", "cat-groceries", "acct-cc", true, null, -1),
  txn("lm-05", 14, "EXPENSE", 220.0, "Dining (month)", "cat-dining", "acct-cc", true, null, -1),
  txn("lm-06", 18, "EXPENSE", 175.25, "Utilities", "cat-utilities", "acct-checking", true, null, -1),
  txn("lm-07", 21, "EXPENSE", 60.0, "Gas", "cat-gas", "acct-cc", true, null, -1),
  // Planet Fitness — unlinked repeat (shows up as a suggestion on Recurring page)
  txn("pf-01", 15, "EXPENSE", 24.99, "Planet Fitness", "cat-personal-care", "acct-cc", true, null, -1),
  txn("pf-02", 15, "EXPENSE", 24.99, "Planet Fitness", "cat-personal-care", "acct-cc", true, null, -2),
  txn("pf-03", 15, "EXPENSE", 24.99, "Planet Fitness", "cat-personal-care", "acct-cc", true, null, -3),
  txn("pf-04", 15, "EXPENSE", 24.99, "Planet Fitness", "cat-personal-care", "acct-cc", true, null, -4),
];

export const DEMO_TAGS: TagDTO[] = [TAG_VACATION, TAG_REIMBURSABLE].map((chip) => {
  const tagged = DEMO_TRANSACTIONS.filter((t) => t.tags.some((x) => x.id === chip.id));
  return {
    ...chip,
    usageCount: tagged.length,
    totalAmount: tagged.reduce((sum, t) => sum + t.amount, 0),
  };
});

// ---------------------------------------------------------------------------
// Budgets (current month)
// ---------------------------------------------------------------------------

const DEMO_BUDGET_LINES: Array<Omit<BudgetLineDTO, "rollover" | "carryover" | "effectiveLimit">> = [
  // Budgeted categories
  {
    categoryId: "cat-groceries",
    name: "Groceries",
    color: "#65a30d",
    icon: "shopping-cart",
    limit: 700,
    actual: 208.16, // 86.42 + 121.74
  },
  {
    categoryId: "cat-dining",
    name: "Dining Out",
    color: "#d97706",
    icon: "utensils",
    limit: 300,
    actual: 54.18,
  },
  {
    categoryId: "cat-gas",
    name: "Gas / Fuel",
    color: "#0e7490",
    icon: "fuel",
    limit: 200,
    actual: 42.3,
  },
  {
    categoryId: "cat-entertainment",
    name: "Entertainment",
    color: "#7c3aed",
    icon: "clapperboard",
    limit: 150,
    actual: 0,
  },
  // Unbudgeted categories with spending (limit 0 means no budget set)
  {
    categoryId: "cat-health",
    name: "Health",
    color: "#e11d48",
    icon: "heart-pulse",
    limit: 0,
    actual: 64,
  },
  {
    categoryId: "cat-subscriptions",
    name: "Subscriptions",
    color: "#8b5cf6",
    icon: "repeat",
    limit: 0,
    actual: 15.99,
  },
  {
    categoryId: "cat-utilities",
    name: "Utilities",
    color: "#ea580c",
    icon: "zap",
    limit: 0,
    actual: 180,
  },
  {
    categoryId: "cat-mortgage",
    name: "Rent / Mortgage",
    color: "#dc2626",
    icon: "home",
    limit: 0,
    actual: 2150,
  },
  {
    categoryId: "cat-savings",
    name: "Savings / Investing",
    color: "#15803d",
    icon: "piggy-bank",
    limit: 0,
    actual: 500,
  },
];

export const DEMO_BUDGETS: BudgetLineDTO[] = DEMO_BUDGET_LINES.map((b) => ({
  ...b,
  rollover: false,
  carryover: 0,
  effectiveLimit: b.limit,
}));

export const DEMO_BUDGET_SUGGESTIONS: BudgetSuggestionsDTO = {
  categories: [
    {
      categoryId: "cat-mortgage",
      name: "Rent / Mortgage",
      color: "#dc2626",
      icon: "home",
      currentLimit: 0,
      recentTotals: [2150, 2150, 2150, 2150, 2150, 2150],
      suggested: 2150,
      items: [
        { id: "demo-rule-rent", description: "Oakwood Apartments", source: "rule", cadence: "monthly", monthlyAmount: 2150 },
      ],
    },
    {
      categoryId: "cat-utilities",
      name: "Utilities",
      color: "#ea580c",
      icon: "zap",
      currentLimit: 0,
      recentTotals: [241.3, 228.75, 205.1, 198.4, 212.6, 224.9],
      suggested: 219,
      items: [
        { id: "demo-rule-electric", description: "City Power & Light", source: "rule", cadence: "monthly", monthlyAmount: 132.4 },
        { id: "demo-det-internet", description: "COMCAST XFINITY", source: "detected", cadence: "about monthly", monthlyAmount: 86.5 },
      ],
    },
    {
      categoryId: "cat-subscriptions",
      name: "Subscriptions",
      color: "#8b5cf6",
      icon: "repeat",
      currentLimit: 0,
      recentTotals: [58.67, 58.67, 40.68, 40.68, 40.68, 40.68],
      suggested: 41,
      items: [
        { id: "demo-rule-netflix", description: "Netflix", source: "rule", cadence: "monthly", monthlyAmount: 15.99 },
        { id: "demo-det-spotify", description: "SPOTIFY USA", source: "detected", cadence: "about monthly", monthlyAmount: 11.99 },
        { id: "demo-det-icloud", description: "APPLE.COM/BILL", source: "detected", cadence: "about monthly", monthlyAmount: 9.99 },
        { id: "demo-rule-nyt", description: "NYTimes", source: "rule", cadence: "every 4 weeks", monthlyAmount: 2.71 },
        { id: "demo-det-hulu", description: "HULU", source: "detected", cadence: "about monthly", monthlyAmount: 17.99, stale: true },
      ],
    },
    {
      categoryId: "cat-groceries",
      name: "Groceries",
      color: "#65a30d",
      icon: "shopping-cart",
      currentLimit: 0,
      recentTotals: [512.44, 388.1, 434.2, 466.85, 401.32, 445.7],
      suggested: 435,
      items: [
        {
          id: "variable:cat-groceries", description: "Typical variable spending", source: "typical",
          cadence: "median of recent months", monthlyAmount: 434.2,
          topExpenses: [
            { description: "WHOLE FOODS MARKET", total: 1284.5, count: 18 },
            { description: "TRADER JOE'S #552", total: 743.28, count: 14 },
            { description: "COSTCO WHOLESALE", total: 512.6, count: 4 },
            { description: "SAFEWAY 1189", total: 88.23, count: 3 },
          ],
        },
      ],
    },
  ],
  uncategorizedCount: 1,
};

// ---------------------------------------------------------------------------
// Savings goals
// ---------------------------------------------------------------------------

export const DEMO_GOALS: SavingsGoalDTO[] = [
  { id: "goal-emergency", name: "Emergency fund", targetAmount: 15000, currentAmount: 9200, targetDate: null, color: "#16a34a", icon: "shield", archived: false },
  { id: "goal-vacation", name: "Hawaii vacation", targetAmount: 6000, currentAmount: 2400, targetDate: monthStart(6), color: "#0891b2", icon: "plane", archived: false },
  { id: "goal-car", name: "New car fund", targetAmount: 25000, currentAmount: 8500, targetDate: null, color: "#7c3aed", icon: "car", archived: false },
  { id: "goal-house", name: "House down payment", targetAmount: 60000, currentAmount: 18000, targetDate: null, color: "#2563eb", icon: "home", archived: false },
];

// ---------------------------------------------------------------------------
// Net-worth snapshots (last 7 months)
// ---------------------------------------------------------------------------

export function buildDemoSnapshots(): SnapshotDTO[] {
  const snapshotAccounts: Array<{ id: string; current: number; isAsset: boolean }> = [
    { id: "acct-401k", current: 142500, isAsset: true },
    { id: "acct-roth", current: 38250, isAsset: true },
    { id: "acct-car", current: 24800, isAsset: true },
    { id: "acct-savings", current: 18400, isAsset: true },
    { id: "acct-checking", current: 5240.5, isAsset: true },
    { id: "acct-cc", current: 1284.32, isAsset: false },
  ];
  const out: SnapshotDTO[] = [];
  for (const acc of snapshotAccounts) {
    for (let i = 6; i >= 0; i--) {
      const drift = acc.id === "acct-car" ? 1 + i * 0.012 : 1 - i * 0.018;
      out.push({
        id: `snap-${acc.id}-${i}`,
        accountId: acc.id,
        date: monthStart(-i),
        balance: Math.round(acc.current * drift * 100) / 100,
        note: null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recurring suggestions (Planet Fitness — 4 months of unlinked hits)
// ---------------------------------------------------------------------------

export const DEMO_SUGGESTIONS: RecurringSuggestion[] = [
  {
    key: "planet-fitness",
    description: "Planet Fitness",
    amount: 24.99,
    type: "EXPENSE",
    frequency: "MONTHLY",
    interval: 1,
    count: 4,
    categoryId: "cat-personal-care",
    accountId: "acct-cc",
    startDate: day(15),
    cadence: "about monthly",
  },
];

// ---------------------------------------------------------------------------
// Notification center (read-only preview in the live demo)
// ---------------------------------------------------------------------------

/** Minutes/hours ago as an ISO string, relative to now. */
function agoISO(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const DEMO_NOTIFICATION_CHANNELS: ChannelDTO[] = [
  { id: "demo-chan-discord", name: "money-alerts", kind: "discord", webhookUrl: "https://discord.com/api/webhooks/•••••/••••••••" },
];

export const DEMO_NOTIFICATION_RULES: RuleDTO[] = [
  {
    id: "demo-rule-large",
    name: "Large purchase over $500",
    enabled: true,
    trigger: "large-transaction",
    params: JSON.stringify({ amount: 500 }),
    channelId: "demo-chan-discord",
    templateTitle: null,
    templateBody: null,
  },
  {
    id: "demo-rule-ccdue",
    name: "Card payment due soon",
    enabled: true,
    trigger: "cc-due",
    params: JSON.stringify({ days: 3 }),
    channelId: "demo-chan-discord",
    templateTitle: null,
    templateBody: null,
  },
  {
    id: "demo-rule-lowbal",
    name: "Checking running low",
    enabled: false,
    trigger: "low-balance",
    params: JSON.stringify({ amount: 200, accountId: "acct-checking" }),
    channelId: null,
    templateTitle: "Heads up: {{account}} is low",
    templateBody: "{{account}} is down to {{balance}}.",
  },
  {
    id: "demo-rule-digest",
    name: "Weekly money digest",
    enabled: true,
    trigger: "digest",
    params: JSON.stringify({ frequency: "weekly", weekday: 1, hour: 8, days: 7 }),
    channelId: "demo-chan-discord",
    templateTitle: null,
    templateBody: null,
  },
];

export const DEMO_NOTIFICATIONS: NotificationDTO[] = [
  {
    id: "demo-notif-1",
    ruleName: "Large purchase over $500",
    title: "Large purchase: $842.19",
    body: "A $842.19 charge from BEST BUY posted to Sapphire Card.",
    firedAt: agoISO(38),
    readAt: null,
    deliveryStatus: "sent",
    deliveryError: null,
  },
  {
    id: "demo-notif-2",
    ruleName: "Card payment due soon",
    title: "Sapphire Card payment due in 3 days",
    body: "Statement balance of $1,106.54 is due on the 18th.",
    firedAt: agoISO(190),
    readAt: null,
    deliveryStatus: "sent",
    deliveryError: null,
  },
  {
    id: "demo-notif-3",
    ruleName: "Weekly money digest",
    title: "Your week in money",
    body: "Spent $612 across 14 transactions. Top category: Groceries ($208).",
    firedAt: agoISO(60 * 26),
    readAt: agoISO(60 * 25),
    deliveryStatus: "sent",
    deliveryError: null,
  },
  {
    id: "demo-notif-4",
    ruleName: "Checking running low",
    title: "Joint Checking is low",
    body: "Joint Checking is down to $184.20.",
    firedAt: agoISO(60 * 72),
    readAt: agoISO(60 * 71),
    deliveryStatus: "in_app",
    deliveryError: null,
  },
];
