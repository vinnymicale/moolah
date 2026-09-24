// What a household member is allowed to do. Page views and writes are
// capabilities an admin can toggle per member; household administration
// (settings, credentials, membership) deliberately is not - it stays tied to the
// OWNER/ADMIN role so the Plaid secret can never be handed out by a checkbox.

export const CAPABILITIES = [
  "VIEW_DASHBOARD",
  "VIEW_TRANSACTIONS",
  "VIEW_ACCOUNTS",
  "VIEW_BUDGETS",
  "VIEW_GOALS",
  "VIEW_DEBT",
  "VIEW_RETIREMENT",
  "VIEW_TRENDS",
  "VIEW_CALENDAR",
  "VIEW_CATEGORIES",
  "VIEW_RULES",
  "EDIT_TRANSACTIONS",
  "MANAGE_BUDGETS",
  "MANAGE_CATEGORIES",
  "MANAGE_RULES",
  "MANAGE_GOALS",
  "MANAGE_RECURRING",
  "MANAGE_ACCOUNTS",
  "MANAGE_RETIREMENT",
  "RUN_SYNC",
  "EXPORT_DATA",
  "USE_CHAT",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type HouseholdRoleName = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const ALL = new Set<Capability>(CAPABILITIES);
const VIEWS = CAPABILITIES.filter((c) => c.startsWith("VIEW_"));

// A member runs the household's day-to-day money: they record spending, set
// budgets and goals, and manage recurring items. Structural things that change
// how every number is derived - categories, rules, linked accounts, exports -
// stay with an admin unless granted explicitly.
const MEMBER_EXTRAS: Capability[] = [
  "EDIT_TRANSACTIONS",
  "MANAGE_BUDGETS",
  "MANAGE_GOALS",
  "MANAGE_RECURRING",
  "MANAGE_RETIREMENT",
  // The assistant reads the whole ledger and spends the household's API key, so
  // a viewer does not get it by virtue of being able to see the same numbers.
  "USE_CHAT",
];

export function isCapability(value: string): value is Capability {
  return ALL.has(value as Capability);
}

export function roleDefaults(role: HouseholdRoleName): Set<Capability> {
  switch (role) {
    case "OWNER":
    case "ADMIN":
      return new Set(ALL);
    case "MEMBER":
      return new Set<Capability>([...VIEWS, ...MEMBER_EXTRAS]);
    case "VIEWER":
      return new Set<Capability>(VIEWS);
  }
}

/**
 * The capabilities a member actually has: their role's defaults, plus explicit
 * grants, minus explicit denials. Deny wins so the two arrays can never
 * contradict each other, and unknown strings (left behind by an older release
 * that had a capability we've since removed) are dropped rather than trusted.
 *
 * Admins short-circuit to everything - an override must not be able to lock the
 * people who administer the household out of it.
 */
export function resolveCapabilities(
  role: HouseholdRoleName,
  granted: string[],
  denied: string[],
): Set<Capability> {
  if (role === "OWNER" || role === "ADMIN") return new Set(ALL);

  const caps = roleDefaults(role);
  for (const c of granted) if (isCapability(c)) caps.add(c);
  for (const c of denied) if (isCapability(c)) caps.delete(c);
  return caps;
}

export const CAPABILITY_LABELS: Record<Capability, string> = {
  VIEW_DASHBOARD: "View dashboard",
  VIEW_TRANSACTIONS: "View transactions",
  VIEW_ACCOUNTS: "View accounts",
  VIEW_BUDGETS: "View budgets",
  VIEW_GOALS: "View goals",
  VIEW_DEBT: "View debt",
  VIEW_RETIREMENT: "View retirement",
  VIEW_TRENDS: "View trends",
  VIEW_CALENDAR: "View calendar",
  VIEW_CATEGORIES: "View categories",
  VIEW_RULES: "View rules",
  EDIT_TRANSACTIONS: "Edit transactions",
  MANAGE_BUDGETS: "Create and edit budgets",
  MANAGE_CATEGORIES: "Manage categories",
  MANAGE_RULES: "Manage rules",
  MANAGE_GOALS: "Manage goals",
  MANAGE_RECURRING: "Manage recurring items",
  MANAGE_ACCOUNTS: "Add and edit accounts",
  MANAGE_RETIREMENT: "Edit the retirement plan",
  RUN_SYNC: "Run bank sync",
  EXPORT_DATA: "Export data",
  USE_CHAT: "Use the finance assistant",
};

/**
 * How the permission editor lays the capabilities out. Grouping keeps a list of
 * twenty-odd toggles scannable, and it lives here rather than in the component
 * so a capability added to CAPABILITIES without a home fails a test instead of
 * quietly disappearing from the UI.
 */
export const CAPABILITY_GROUPS = [
  { id: "view", label: "Pages", capabilities: VIEWS },
  {
    id: "track",
    label: "Track",
    capabilities: ["EDIT_TRANSACTIONS", "MANAGE_ACCOUNTS", "MANAGE_RECURRING", "RUN_SYNC"],
  },
  {
    id: "plan",
    label: "Plan",
    capabilities: ["MANAGE_BUDGETS", "MANAGE_GOALS", "MANAGE_RETIREMENT"],
  },
  { id: "organize", label: "Organize", capabilities: ["MANAGE_CATEGORIES", "MANAGE_RULES"] },
  { id: "assistant", label: "Assistant", capabilities: ["USE_CHAT"] },
  { id: "data", label: "Data", capabilities: ["EXPORT_DATA"] },
] as const satisfies readonly {
  id: string;
  label: string;
  capabilities: readonly Capability[];
}[];
