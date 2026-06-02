"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard, CalendarDays, Receipt, Landmark, Repeat, Tags, LineChart,
  Settings, Plus, Menu, Wallet, LogOut, Upload, FileSpreadsheet, PiggyBank, Target,
  GripVertical, RotateCcw, ChevronsLeft, Keyboard,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { TransactionModal } from "./TransactionModal";
import { ImportReview } from "./ImportReview";
import { Modal } from "./Modal";
import type { AccountDTO, CategoryDTO } from "@/lib/queries";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/recurring", label: "Recurring", icon: Repeat },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/trends", label: "Trends", icon: LineChart },
  { href: "/settings", label: "Settings", icon: Settings },
];

const NAV_ORDER_KEY = "navOrder";
const NAV_COLLAPSED_KEY = "navCollapsed";
const DEFAULT_ORDER = NAV.map((n) => n.href);
const NAV_BY_HREF = new Map(NAV.map((n) => [n.href, n] as const));

/** Keep the stored order but drop hrefs that no longer exist and append any new ones. */
function mergeNavOrder(stored: string[]): string[] {
  const valid = stored.filter((h) => NAV_BY_HREF.has(h));
  const missing = DEFAULT_ORDER.filter((h) => !valid.includes(h));
  return [...valid, ...missing];
}

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
  const [dragging, setDragging] = useState(false);
  const [importCsv, setImportCsv] = useState<{ text: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Customisable, persisted sidebar order. `mounted` keeps SSR and the first
  // client render on the default order to avoid a hydration mismatch.
  const [navOrder, setNavOrder] = useState<string[]>(DEFAULT_ORDER);
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dragOverHref, setDragOverHref] = useState<string | null>(null);
  const navDragHref = useRef<string | null>(null);

  useEffect(() => {
    let storedOrder: unknown = null;
    let storedCollapsed = false;
    try {
      const raw = localStorage.getItem(NAV_ORDER_KEY);
      if (raw) storedOrder = JSON.parse(raw);
      storedCollapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
    } catch {
      // ignore unavailable/corrupt storage
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate of persisted nav prefs
    setMounted(true);
    if (Array.isArray(storedOrder)) setNavOrder(mergeNavOrder(storedOrder as string[]));
    if (storedCollapsed) setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore unavailable storage
      }
      return next;
    });
  };

  // Global keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "n") { e.preventDefault(); setAddOpen(true); }
      else if (e.key === "i") { e.preventDefault(); fileInputRef.current?.click(); }
      else if (e.key === "?") { e.preventDefault(); setShortcutsOpen(true); }
      else if (e.key === "/") {
        const el = document.querySelector<HTMLInputElement>('[data-search="true"]');
        if (el) { e.preventDefault(); el.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const persistOrder = (next: string[]) => {
    setNavOrder(next);
    try {
      localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next));
    } catch {
      // ignore unavailable storage
    }
  };

  const handleNavDrop = (targetHref: string) => {
    const src = navDragHref.current;
    navDragHref.current = null;
    setDragOverHref(null);
    if (!src || src === targetHref) return;
    const next = [...navOrder];
    const from = next.indexOf(src);
    const to = next.indexOf(targetHref);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, src);
    persistOrder(next);
  };

  const orderedNav = (mounted ? navOrder : DEFAULT_ORDER)
    .map((h) => NAV_BY_HREF.get(h))
    .filter((x): x is (typeof NAV)[number] => !!x);
  const customized = mounted && navOrder.join() !== DEFAULT_ORDER.join();
  const isCollapsed = mounted && collapsed;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const openFile = async (file: File) => {
    const text = await file.text();
    setImportCsv({ text, name: file.name });
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void openFile(file);
    e.target.value = ""; // allow re-importing the same file
  };

  // Global drag-and-drop: dropping a CSV anywhere opens the import review.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types?.includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // allow drop
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && /\.csv$|text\/csv|text\/plain/i.test(`${file.name} ${file.type}`)) {
        void openFile(file);
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const renderSidebar = (compact: boolean, allowCollapse: boolean) => (
    <div className="flex h-full flex-col">
      <div className={`flex items-center py-4 ${compact ? "justify-center px-2" : "justify-between px-4"}`}>
        {!compact && (
          <div className="flex items-center gap-2 text-brand">
            <Wallet size={22} />
            <span className="font-semibold text-text">Household Finance</span>
          </div>
        )}
        {allowCollapse && (
          <button
            onClick={toggleCollapsed}
            className="btn-ghost h-8 w-8 !p-0"
            title={compact ? "Expand menu" : "Collapse menu"}
            aria-label={compact ? "Expand menu" : "Collapse menu"}
          >
            {compact ? <Wallet size={20} className="text-brand" /> : <ChevronsLeft size={18} />}
          </button>
        )}
      </div>
      <div className={`space-y-2 pb-2 ${compact ? "px-2" : "px-3"}`}>
        <button
          onClick={() => { setAddOpen(true); setNavOpen(false); }}
          className={`btn-primary w-full ${compact ? "justify-center !px-0" : ""}`}
          title="Add transaction"
        >
          <Plus size={16} /> {!compact && "Add transaction"}
        </button>
        <button
          onClick={() => { fileInputRef.current?.click(); setNavOpen(false); }}
          className={`btn-ghost w-full text-sm ${compact ? "justify-center !px-0" : "justify-start"}`}
          title="Import transactions from a bank CSV"
        >
          <Upload size={15} /> {!compact && "Import CSV"}
        </button>
      </div>
      <nav className={`flex-1 space-y-0.5 overflow-y-auto py-2 ${compact ? "px-2" : "px-3"}`}>
        {orderedNav.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isOver = dragOverHref === item.href;
          return (
            <div
              key={item.href}
              draggable={!compact}
              onDragStart={(e) => { navDragHref.current = item.href; e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => {
                e.preventDefault();
                const over = navDragHref.current === item.href ? null : item.href;
                if (dragOverHref !== over) setDragOverHref(over);
              }}
              onDrop={(e) => { e.preventDefault(); handleNavDrop(item.href); }}
              onDragEnd={() => { navDragHref.current = null; setDragOverHref(null); }}
              className={`group rounded-lg ${isOver && !compact ? "ring-2 ring-brand/50" : ""}`}
            >
              <Link
                href={item.href}
                onClick={() => setNavOpen(false)}
                title={compact ? item.label : undefined}
                className={`flex items-center rounded-lg py-2 text-sm font-medium transition-colors ${
                  compact ? "justify-center px-2" : "gap-3 px-3"
                } ${active ? "bg-brand/10 text-brand" : "text-muted hover:bg-surface2 hover:text-text"}`}
              >
                <Icon size={18} />
                {!compact && <span className="flex-1">{item.label}</span>}
                {!compact && <GripVertical size={14} className="cursor-grab text-muted opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />}
              </Link>
            </div>
          );
        })}
        {!compact && customized && (
          <button
            onClick={() => persistOrder(DEFAULT_ORDER)}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface2 hover:text-text"
          >
            <RotateCcw size={12} /> Reset menu order
          </button>
        )}
      </nav>
      <div className={`border-t border-line ${compact ? "p-2" : "p-3"}`}>
        {compact ? (
          <div className="mb-1 flex justify-center">
            <ThemeToggle />
          </div>
        ) : (
          <div className="mb-1 flex items-center gap-1">
            <button onClick={() => setShortcutsOpen(true)} className="btn-ghost flex-1 justify-start text-xs text-muted">
              <Keyboard size={14} /> Keyboard shortcuts
            </button>
            <ThemeToggle />
          </div>
        )}
        <div className={`mb-2 flex items-center ${compact ? "justify-center" : "gap-2 px-1"}`}>
          <Avatar user={user} />
          {!compact && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
              <p className="truncate text-xs text-muted">{householdName}</p>
            </div>
          )}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/signin" })}
          className={`btn-ghost w-full text-sm ${compact ? "justify-center !px-0" : "justify-start"}`}
          title="Sign out"
        >
          <LogOut size={15} /> {!compact && "Sign out"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={`hidden shrink-0 border-r border-line bg-surface transition-[width] duration-200 md:block ${isCollapsed ? "w-16" : "w-64"}`}>
        <div className="sticky top-0 h-screen">{renderSidebar(isCollapsed, true)}</div>
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-line bg-surface">{renderSidebar(false, false)}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — mobile only (desktop header is just wasted space) */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur md:hidden">
          <button onClick={() => setNavOpen(true)} className="btn-ghost h-9 w-9 !p-0" aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 font-semibold">
            <Wallet size={18} className="text-brand" />
          </div>
          <div className="flex-1" />
          <button onClick={() => setAddOpen(true)} className="btn-primary h-9">
            <Plus size={16} />
          </button>
        </header>

        <main className="flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>

      <TransactionModal open={addOpen} onClose={() => setAddOpen(false)} accounts={accounts} categories={categories} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={onFilePicked}
      />

      <ImportReview
        open={!!importCsv}
        onClose={() => setImportCsv(null)}
        csvText={importCsv?.text ?? null}
        filename={importCsv?.name}
        accounts={accounts}
        categories={categories}
      />

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Drag-to-import overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-60 flex items-center justify-center bg-brand/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-brand bg-surface px-10 py-8 text-center shadow-lg">
            <FileSpreadsheet size={36} className="text-brand" />
            <p className="font-semibold">Drop your bank CSV to import</p>
            <p className="text-sm text-muted">We&apos;ll parse it and let you review before adding anything.</p>
          </div>
        </div>
      )}
    </div>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["n"], label: "Add a transaction" },
  { keys: ["i"], label: "Import a CSV" },
  { keys: ["/"], label: "Focus search (on pages with it)" },
  { keys: ["?"], label: "Show this help" },
];

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" widthClass="max-w-sm">
      <ul className="space-y-2">
        {SHORTCUTS.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted">{s.label}</span>
            <span className="flex gap-1">
              {s.keys.map((k) => (
                <kbd key={k} className="rounded border border-line bg-surface2 px-2 py-0.5 font-mono text-xs">{k}</kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">Shortcuts are ignored while you&apos;re typing in a field.</p>
    </Modal>
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
