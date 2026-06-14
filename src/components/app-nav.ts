import {
  LayoutDashboard, CalendarDays, Receipt, Landmark, Repeat, Tags, LineChart,
  Settings, PiggyBank, Target, TrendingDown, Wallet,
} from "lucide-react";

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/networth", label: "Net Worth", icon: Wallet },
  { href: "/recurring", label: "Recurring", icon: Repeat },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/debt", label: "Debt payoff", icon: TrendingDown },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/trends", label: "Trends", icon: LineChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

export type NavItem = (typeof NAV)[number];

export const NAV_ORDER_KEY = "navOrder";
export const NAV_COLLAPSED_KEY = "navCollapsed";
export const DEFAULT_ORDER = NAV.map((n) => n.href);
export const NAV_BY_HREF = new Map(NAV.map((n) => [n.href, n] as const));

/** Keep the stored order but drop hrefs that no longer exist and append any new ones. */
export function mergeNavOrder(stored: string[]): string[] {
  const valid = stored.filter((h) => NAV_BY_HREF.has(h));
  const missing = DEFAULT_ORDER.filter((h) => !valid.includes(h));
  return [...valid, ...missing];
}
