// Default categories seeded for every new user. Kept here so both the
// first-run setup flow and the demo seed stay in sync.

export interface DefaultCategory {
  name: string;
  kind: "INCOME" | "EXPENSE";
  color: string;
  icon: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // Income
  { name: "Salary", kind: "INCOME", color: "#16a34a", icon: "briefcase" },
  { name: "Bonus", kind: "INCOME", color: "#22c55e", icon: "gift" },
  { name: "Interest", kind: "INCOME", color: "#10b981", icon: "percent" },
  { name: "Investment Income", kind: "INCOME", color: "#059669", icon: "trending-up" },
  { name: "Refund", kind: "INCOME", color: "#34d399", icon: "rotate-ccw" },
  { name: "Other Income", kind: "INCOME", color: "#6ee7b7", icon: "plus-circle" },

  // Expense - housing & utilities
  { name: "Rent / Mortgage", kind: "EXPENSE", color: "#dc2626", icon: "home" },
  { name: "Utilities", kind: "EXPENSE", color: "#ea580c", icon: "zap" },
  { name: "Internet / Phone", kind: "EXPENSE", color: "#f97316", icon: "wifi" },
  { name: "Home Maintenance", kind: "EXPENSE", color: "#b45309", icon: "wrench" },

  // Everyday
  { name: "Groceries", kind: "EXPENSE", color: "#65a30d", icon: "shopping-cart" },
  { name: "Dining Out", kind: "EXPENSE", color: "#d97706", icon: "utensils" },
  { name: "Transportation", kind: "EXPENSE", color: "#0891b2", icon: "car" },
  { name: "Gas / Fuel", kind: "EXPENSE", color: "#0e7490", icon: "fuel" },
  { name: "Shopping", kind: "EXPENSE", color: "#c026d3", icon: "shopping-bag" },

  // Health & insurance
  { name: "Health", kind: "EXPENSE", color: "#e11d48", icon: "heart-pulse" },
  { name: "Insurance", kind: "EXPENSE", color: "#9333ea", icon: "shield" },

  // Lifestyle
  { name: "Entertainment", kind: "EXPENSE", color: "#7c3aed", icon: "clapperboard" },
  { name: "Subscriptions", kind: "EXPENSE", color: "#8b5cf6", icon: "repeat" },
  { name: "Travel", kind: "EXPENSE", color: "#2563eb", icon: "plane" },
  { name: "Personal Care", kind: "EXPENSE", color: "#db2777", icon: "sparkles" },
  { name: "Gifts / Donations", kind: "EXPENSE", color: "#f43f5e", icon: "gift" },

  // Financial
  { name: "Childcare", kind: "EXPENSE", color: "#0d9488", icon: "baby" },
  { name: "Education", kind: "EXPENSE", color: "#4f46e5", icon: "graduation-cap" },
  { name: "Debt Payment", kind: "EXPENSE", color: "#be123c", icon: "credit-card" },
  { name: "Savings / Investing", kind: "EXPENSE", color: "#15803d", icon: "piggy-bank" },
  { name: "Taxes", kind: "EXPENSE", color: "#991b1b", icon: "landmark" },
  { name: "Fees", kind: "EXPENSE", color: "#a16207", icon: "receipt" },
  { name: "Other Expense", kind: "EXPENSE", color: "#64748b", icon: "tag" },
];
