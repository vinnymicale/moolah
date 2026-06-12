"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  Plus, Search, Upload, ChevronsLeft, GripVertical, RotateCcw, Keyboard, LogOut, Coffee,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./Avatar";
import type { NavItem } from "./app-nav";

const COFFEE_URL = "https://buymeacoffee.com/vinnymicale";
const GITHUB_URL = "https://github.com/vinnymicale/moolah";

export interface SidebarProps {
  /** Icon-only rail (desktop collapsed) vs. full-width sidebar. */
  compact: boolean;
  /** Whether to show the collapse toggle (desktop only, not the mobile drawer). */
  allowCollapse: boolean;
  user: { name?: string | null; email?: string | null; image?: string | null };
  authBypass: boolean;
  demoMode?: boolean;
  nav: NavItem[];
  isActive: (href: string) => boolean;
  customized: boolean;
  onToggleCollapsed: () => void;
  onAdd: () => void;
  onSearch: () => void;
  onImport: () => void;
  /** Called after navigating, to close the mobile drawer. */
  onNavigate: () => void;
  onShortcuts: () => void;
  onReorder: (source: string, target: string) => void;
  onResetOrder: () => void;
}

export function Sidebar({
  compact,
  allowCollapse,
  user,
  authBypass,
  demoMode = false,
  nav,
  isActive,
  customized,
  onToggleCollapsed,
  onAdd,
  onSearch,
  onImport,
  onNavigate,
  onShortcuts,
  onReorder,
  onResetOrder,
}: SidebarProps) {
  const dragHref = useRef<string | null>(null);
  const [dragOverHref, setDragOverHref] = useState<string | null>(null);

  const handleDrop = (targetHref: string) => {
    const source = dragHref.current;
    dragHref.current = null;
    setDragOverHref(null);
    if (source && source !== targetHref) onReorder(source, targetHref);
  };

  return (
    <div className="flex h-full flex-col">
      <div className={`flex items-center py-4 ${compact ? "justify-center px-2" : "justify-between px-4"}`}>
        {!compact && (
          <div className="flex items-center gap-2 text-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" width={28} height={28} className="h-7 w-7" />
            <span className="font-semibold text-text">Moolah</span>
          </div>
        )}
        {allowCollapse && (
          <button
            onClick={onToggleCollapsed}
            className="btn-ghost h-8 w-8 p-0!"
            title={compact ? "Expand menu" : "Collapse menu"}
            aria-label={compact ? "Expand menu" : "Collapse menu"}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {compact ? <img src="/logo.png" alt="Expand menu" width={22} height={22} className="h-5.5 w-5.5" /> : <ChevronsLeft size={18} />}
          </button>
        )}
      </div>
      <div className={`space-y-2 pb-2 ${compact ? "px-2" : "px-3"}`}>
        <button
          onClick={onAdd}
          className={`btn-primary w-full ${compact ? "justify-center px-0!" : ""}`}
          title="Add transaction"
        >
          <Plus size={16} /> {!compact && "Add transaction"}
        </button>
        <button
          onClick={onSearch}
          className={`btn-ghost w-full text-sm ${compact ? "justify-center px-0!" : "justify-between"}`}
          title="Search all transactions (⌘K)"
        >
          <span className="flex items-center gap-2">
            <Search size={15} /> {!compact && "Search"}
          </span>
          {!compact && (
            <kbd className="rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[10px] text-muted">⌘K</kbd>
          )}
        </button>
        <button
          onClick={onImport}
          className={`btn-ghost w-full text-sm ${compact ? "justify-center px-0!" : "justify-start"}`}
          title="Import transactions from a bank CSV"
        >
          <Upload size={15} /> {!compact && "Import CSV"}
        </button>
      </div>
      <nav className={`flex-1 space-y-0.5 overflow-y-auto py-2 ${compact ? "px-2" : "px-3"}`}>
        {nav.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isOver = dragOverHref === item.href;
          return (
            <div
              key={item.href}
              draggable={!compact}
              onDragStart={(e) => { dragHref.current = item.href; e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => {
                e.preventDefault();
                const over = dragHref.current === item.href ? null : item.href;
                if (dragOverHref !== over) setDragOverHref(over);
              }}
              onDrop={(e) => { e.preventDefault(); handleDrop(item.href); }}
              onDragEnd={() => { dragHref.current = null; setDragOverHref(null); }}
              className={`group rounded-lg ${isOver && !compact ? "ring-2 ring-brand/50" : ""}`}
            >
              <Link
                href={item.href}
                onClick={onNavigate}
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
            onClick={onResetOrder}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface2 hover:text-text"
          >
            <RotateCcw size={12} /> Reset menu order
          </button>
        )}
      </nav>
      <div className={`border-t border-line ${compact ? "p-2" : "p-3"}`}>
        <div className={`mb-2 flex items-center ${compact ? "justify-center" : "gap-2 px-1"}`}>
          <Avatar user={user} />
          {!compact && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name ?? "Moolah"}</p>
              {authBypass && (
                <p className="text-xs text-muted">
                  <span className="rounded bg-surface2 px-1 py-px text-[10px] font-medium">local</span>
                </p>
              )}
            </div>
          )}
        </div>
        {compact ? (
          <div className="mb-1 flex justify-center">
            <ThemeToggle />
          </div>
        ) : (
          <div className="mb-1 flex items-center gap-1">
            <button onClick={onShortcuts} className="btn-ghost flex-1 justify-start text-xs text-muted">
              <Keyboard size={14} /> Keyboard shortcuts
            </button>
            <ThemeToggle />
          </div>
        )}
        {!authBypass && (
          <button
            onClick={() => signOut({ callbackUrl: "/signin" })}
            className={`mb-1 btn-ghost w-full text-sm ${compact ? "justify-center px-0!" : "justify-start"}`}
            title="Sign out"
          >
            <LogOut size={15} /> {!compact && "Sign out"}
          </button>
        )}
        <div className={`flex items-center gap-1 ${compact ? "flex-col" : ""}`}>
          <a
            href={COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn-ghost text-sm text-muted ${compact ? "w-full justify-center px-0!" : "flex-1 justify-start"}`}
            title="Enjoying Moolah? Buy me a coffee"
          >
            <Coffee size={15} /> {!compact && "Buy me a coffee"}
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn-ghost text-sm text-muted ${compact ? "w-full justify-center px-0!" : "shrink-0 px-2"}`}
            title="View source on GitHub"
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          </a>
        </div>
        {demoMode && !compact && (
          <div className="mt-2 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-xs text-brand">
            <p className="font-semibold">Demo mode</p>
            <p className="text-brand/70">Changes are local only and reset on refresh.</p>
          </div>
        )}
      </div>
    </div>
  );
}
