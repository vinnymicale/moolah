"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard, CalendarDays, Receipt, Landmark, Repeat, Tags, LineChart,
  Settings, Plus, Menu, X, Wallet, LogOut,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { TransactionModal } from "./TransactionModal";
import type { AccountDTO, CategoryDTO } from "@/lib/queries";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/recurring", label: "Recurring", icon: Repeat },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/trends", label: "Trends", icon: LineChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppChrome({
  children,
  user,
  householdName,
  accounts,
  categories,
}: {
  children: React.ReactNode;
  user: { name?: string | null; email?: string | null; image?: string | null };
  householdName: string;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const SidebarBody = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4 text-brand">
        <Wallet size={22} />
        <span className="font-semibold text-text">Household Finance</span>
      </div>
      <div className="px-3 pb-2">
        <button onClick={() => { setAddOpen(true); setNavOpen(false); }} className="btn-primary w-full">
          <Plus size={16} /> Add transaction
        </button>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setNavOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? "bg-brand/10 text-brand" : "text-muted hover:bg-surface2 hover:text-text"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <Avatar user={user} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
            <p className="truncate text-xs text-muted">{householdName}</p>
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/signin" })} className="btn-ghost w-full justify-start text-sm">
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface md:block">
        <div className="sticky top-0 h-screen">{SidebarBody}</div>
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-line bg-surface">{SidebarBody}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur md:px-6">
          <button onClick={() => setNavOpen(true)} className="btn-ghost h-9 w-9 !p-0 md:hidden" aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 font-semibold md:hidden">
            <Wallet size={18} className="text-brand" />
          </div>
          <div className="flex-1" />
          <button onClick={() => setAddOpen(true)} className="btn-primary h-9 md:hidden">
            <Plus size={16} />
          </button>
          <ThemeToggle />
        </header>

        <main className="flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>

      <TransactionModal open={addOpen} onClose={() => setAddOpen(false)} accounts={accounts} categories={categories} />
    </div>
  );
}

function Avatar({ user }: { user: { name?: string | null; email?: string | null; image?: string | null } }) {
  if (user.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.image} alt="" className="h-8 w-8 rounded-full" />;
  }
  const initial = (user.name ?? user.email ?? "?").charAt(0).toUpperCase();
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand">
      {initial}
    </div>
  );
}
