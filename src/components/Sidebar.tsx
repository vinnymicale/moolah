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

export interface SidebarProps {
  /** Icon-only rail (desktop collapsed) vs. full-width sidebar. */
  compact: boolean;
  /** Whether to show the collapse toggle (desktop only, not the mobile drawer). */
  allowCollapse: boolean;
  user: { name?: string | null; email?: string | null; image?: string | null };
  householdName: string;
  authBypass: boolean;
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
  householdName,
  authBypass,
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
              <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                {householdName}
                {authBypass && (
                  <span className="shrink-0 rounded bg-surface2 px-1 py-px text-[10px] font-medium text-muted">
                    local
                  </span>
                )}
              </p>
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
        <a
          href={COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`btn-ghost w-full text-sm text-muted ${compact ? "justify-center px-0!" : "justify-start"}`}
          title="Enjoying Moolah? Buy me a coffee"
        >
          <Coffee size={15} /> {!compact && "Buy me a coffee"}
        </a>
      </div>
    </div>
  );
}
