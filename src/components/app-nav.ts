import {
  LayoutDashboard, CalendarDays, Receipt, Landmark, Repeat, Tags, LineChart,
  Settings, PiggyBank, Target, TrendingDown, Wallet, Bell,
} from "lucide-react";

export type NavGroupId = "overview" | "track" | "plan" | "insights" | "system";

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "overview" as NavGroupId },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, group: "overview" as NavGroupId },
  { href: "/notifications", label: "Notifications", icon: Bell, group: "overview" as NavGroupId },
  { href: "/transactions", label: "Transactions", icon: Receipt, group: "track" as NavGroupId },
  { href: "/accounts", label: "Accounts", icon: Landmark, group: "track" as NavGroupId },
  { href: "/recurring", label: "Recurring", icon: Repeat, group: "track" as NavGroupId },
  { href: "/budgets", label: "Budgets", icon: PiggyBank, group: "plan" as NavGroupId },
  { href: "/goals", label: "Goals", icon: Target, group: "plan" as NavGroupId },
  { href: "/debt", label: "Debt payoff", icon: TrendingDown, group: "plan" as NavGroupId },
  { href: "/networth", label: "Net worth", icon: Wallet, group: "insights" as NavGroupId },
  { href: "/trends", label: "Trends", icon: LineChart, group: "insights" as NavGroupId },
  { href: "/categories", label: "Categories & Rules", icon: Tags, group: "insights" as NavGroupId },
  { href: "/settings", label: "Settings", icon: Settings, group: "system" as NavGroupId },
];

export type NavItem = (typeof NAV)[number];

/** Sidebar sections, in display order. Overview and system render without a
 *  heading; the rest get a small eyebrow label. */
export const NAV_GROUPS: { id: NavGroupId; label: string | null }[] = [
  { id: "overview", label: null },
  { id: "track", label: "Track" },
  { id: "plan", label: "Plan" },
  { id: "insights", label: "Insights" },
  { id: "system", label: null },
];

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
