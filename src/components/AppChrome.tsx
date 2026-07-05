"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Menu, FileSpreadsheet, Search, Bot, Upload, Keyboard } from "lucide-react";
import type { Command } from "@/lib/commands";
import { TransactionModal } from "./TransactionModal";
import { ImportReview } from "./ImportReview";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsModal } from "./ShortcutsModal";
import { DemoWelcomeModal } from "./DemoWelcomeModal";
import { ChatPanel } from "./ChatPanel";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./Toast";
import {
  NAV, NAV_ORDER_KEY, NAV_COLLAPSED_KEY, DEFAULT_ORDER, NAV_BY_HREF, mergeNavOrder, type NavItem,
} from "./app-nav";
import { usePersistentState } from "@/lib/usePersistentState";
import type { AccountDTO, CategoryDTO } from "@/lib/queries";


export function AppChrome({
  children,
  user,
  accounts,
  categories,
  authBypass = false,
  demoMode = false,
}: {
  children: React.ReactNode;
  user: { name?: string | null; email?: string | null; image?: string | null };
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  authBypass?: boolean;
  demoMode?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // The route the browser actually loaded, captured once at mount. A full reload
  // remounts AppChrome and re-snapshots this; client-side navigation doesn't.
  // The demo welcome modal keys off it so it only shows on a fresh dashboard load.
  const [initialPath] = useState(pathname);
  const [navOpen, setNavOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importCsv, setImportCsv] = useState<{ text: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Customisable, persisted sidebar order and collapsed state. usePersistentState
  // renders the defaults on the server and first client paint, then reconciles to
  // the stored values - no hydration mismatch.
  const [navOrder, persistOrder] = usePersistentState<string[]>(NAV_ORDER_KEY, DEFAULT_ORDER);
  const [collapsed, setCollapsed] = usePersistentState(NAV_COLLAPSED_KEY, false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const toggleCollapsed = () => setCollapsed(!collapsed);

  // Global keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K opens global search - handled even while typing.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "n") { e.preventDefault(); setAddOpen(true); }
      else if (e.key === "c") { e.preventDefault(); setChatOpen((v) => !v); }
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

  // Drop hrefs that no longer exist and append any new ones before display/reorder.
  const mergedOrder = mergeNavOrder(navOrder);

  const reorderNav = (source: string, target: string) => {
    const next = [...mergedOrder];
    const from = next.indexOf(source);
    const to = next.indexOf(target);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, source);
    persistOrder(next);
  };

  const orderedNav = mergedOrder
    .map((h) => NAV_BY_HREF.get(h))
    .filter((x): x is NavItem => !!x);
  const customized = mergedOrder.join() !== DEFAULT_ORDER.join();
  const isCollapsed = collapsed;

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

  // Command-palette entries: jump to any page, or run the same quick actions the
  // sidebar/shortcuts expose. The palette closes itself before calling `run`.
  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = NAV.map((item) => ({
      id: `nav:${item.href}`,
      label: item.label,
      keywords: `go to open ${item.label}`,
      hint: "Page",
      icon: item.icon,
      run: () => router.push(item.href),
    }));
    const actions: Command[] = [
      { id: "act:add", label: "New transaction", keywords: "add create expense income", icon: Plus, run: () => setAddOpen(true) },
      { id: "act:import", label: "Import CSV", keywords: "upload bank statement", icon: Upload, run: () => fileInputRef.current?.click() },
      { id: "act:shortcuts", label: "Keyboard shortcuts", keywords: "help keys hotkeys", icon: Keyboard, run: () => setShortcutsOpen(true) },
      ...(demoMode
        ? []
        : [{ id: "act:chat", label: "Finance assistant", keywords: "chat ai ask bot", icon: Bot, run: () => setChatOpen(true) } as Command]),
    ];
    return [...actions, ...nav];
  }, [router, demoMode]);

  const sidebarProps = {
    user,
    authBypass,
    demoMode,
    nav: orderedNav,
    isActive,
    customized,
    onToggleCollapsed: toggleCollapsed,
    onAdd: () => { setAddOpen(true); setNavOpen(false); },
    onSearch: () => { setSearchOpen(true); setNavOpen(false); },
    onImport: () => { fileInputRef.current?.click(); setNavOpen(false); },
    onNavigate: () => setNavOpen(false),
    onShortcuts: () => setShortcutsOpen(true),
    onReorder: reorderNav,
    onResetOrder: () => persistOrder(DEFAULT_ORDER),
  };

  return (
    <ToastProvider>
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className={`hidden shrink-0 border-r border-line bg-surface transition-[width] duration-200 md:block ${isCollapsed ? "w-16" : "w-64"}`}>
        <div className="sticky top-0 h-screen">
          <Sidebar {...sidebarProps} compact={isCollapsed} allowCollapse />
        </div>
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-line bg-surface">
            <Sidebar {...sidebarProps} compact={false} allowCollapse={false} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar - mobile only (desktop header is just wasted space) */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/70 px-4 py-3 backdrop-blur-md md:hidden">
          <button onClick={() => setNavOpen(true)} className="btn-ghost h-9 w-9 p-0!" aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Moolah" width={22} height={22} className="h-5.5 w-5.5" />
          </div>
          <div className="flex-1" />
          <button onClick={() => setSearchOpen(true)} className="btn-ghost h-9 w-9 p-0!" aria-label="Search">
            <Search size={18} />
          </button>
          <button onClick={() => setAddOpen(true)} className="btn-primary h-9">
            <Plus size={16} />
          </button>
        </header>

        <main className="flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>

      {searchOpen && (
        <CommandPalette onClose={() => setSearchOpen(false)} commands={commands} categories={categories} accounts={accounts} />
      )}

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
      {demoMode && <DemoWelcomeModal initialPath={initialPath} />}
      {!demoMode && <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />}

      {/* Floating chat button — hidden in demo mode */}
      {!demoMode && !chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-brand-fg shadow-floating transition-transform duration-200 hover:scale-105 active:scale-95"
          title="Finance assistant (C)"
          aria-label="Open finance assistant"
        >
          <Bot size={22} />
        </button>
      )}

      {/* Drag-to-import overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-60 flex items-center justify-center bg-brand/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-brand bg-surface px-10 py-8 text-center shadow-floating">
            <FileSpreadsheet size={36} className="text-brand" />
            <p className="font-semibold">Drop your bank CSV to import</p>
            <p className="text-sm text-muted">We&apos;ll parse it and let you review before adding anything.</p>
          </div>
        </div>
      )}
    </div>
    </ToastProvider>
  );
}
