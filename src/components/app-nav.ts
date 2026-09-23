import {
  LayoutDashboard, CalendarDays, Receipt, Landmark, Repeat, Tags, LineChart,
  Settings, PiggyBank, Target, TrendingDown, Wallet, Bell, Umbrella,
} from "lucide-react";
import type { Capability } from "@/lib/capabilities";

export type NavGroupId = "overview" | "track" | "plan" | "insights" | "system";

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "overview" as NavGroupId, capability: "VIEW_DASHBOARD" as Capability },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, group: "overview" as NavGroupId, capability: "VIEW_CALENDAR" as Capability },
  // Notifications are per-user, not household data, so every member sees them.
  { href: "/notifications", label: "Notifications", icon: Bell, group: "overview" as NavGroupId, capability: null },
  { href: "/transactions", label: "Transactions", icon: Receipt, group: "track" as NavGroupId, capability: "VIEW_TRANSACTIONS" as Capability },
  { href: "/accounts", label: "Accounts", icon: Landmark, group: "track" as NavGroupId, capability: "VIEW_ACCOUNTS" as Capability },
  { href: "/recurring", label: "Recurring", icon: Repeat, group: "track" as NavGroupId, capability: "VIEW_TRANSACTIONS" as Capability },
  { href: "/budgets", label: "Budgets", icon: PiggyBank, group: "plan" as NavGroupId, capability: "VIEW_BUDGETS" as Capability },
  { href: "/goals", label: "Goals", icon: Target, group: "plan" as NavGroupId, capability: "VIEW_GOALS" as Capability },
  { href: "/debt", label: "Debt payoff", icon: TrendingDown, group: "plan" as NavGroupId, capability: "VIEW_DEBT" as Capability },
  { href: "/retirement", label: "Retirement", icon: Umbrella, group: "plan" as NavGroupId, capability: "VIEW_RETIREMENT" as Capability },
  { href: "/networth", label: "Net worth", icon: Wallet, group: "insights" as NavGroupId, capability: "VIEW_ACCOUNTS" as Capability },
  { href: "/trends", label: "Trends", icon: LineChart, group: "insights" as NavGroupId, capability: "VIEW_TRENDS" as Capability },
  { href: "/categories", label: "Categories & Rules", icon: Tags, group: "insights" as NavGroupId, capability: "VIEW_CATEGORIES" as Capability },
  // Settings covers household credentials and membership: admins only.
  { href: "/settings", label: "Settings", icon: Settings, group: "system" as NavGroupId, capability: "ADMIN" as const },
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

/**
 * The hrefs a member may open. Computed on the server, where the household
 * context lives, and handed to the chrome so the sidebar, the command palette
 * and the mobile tabs all hide the same pages. The page gates still enforce
 * this - hiding a link is presentation, not security.
 */
export function allowedNavHrefs(can: (c: Capability) => boolean, isAdmin: boolean): string[] {
  return NAV.filter((item) => {
    if (item.capability === null) return true;
    if (item.capability === "ADMIN") return isAdmin;
    return can(item.capability);
  }).map((item) => item.href);
}

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
