"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  /** Optional single action (e.g. Undo). Running it dismisses the toast. */
  action?: ToastAction;
  /** Auto-dismiss delay in ms. Defaults to 6s, enough to read and hit Undo. */
  durationMs?: number;
  tone?: "default" | "danger";
}

interface ActiveToast extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * App-wide toast notifications. One toast at a time (newest replaces the
 * previous), bottom-center, with an optional action button. Used for the
 * undo-on-delete flow. Auto-dismisses; respects prefers-reduced-motion via the
 * global CSS transition override.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setActive(null);
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++nextId.current;
    setActive({ ...opts, id });
    timer.current = setTimeout(() => {
      setActive((cur) => (cur?.id === id ? null : cur));
      timer.current = null;
    }, opts.durationMs ?? 6000);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {active && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex justify-center px-4">
          <div
            role={active.tone === "danger" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-floating animate-[toast-in_180ms_ease-out] ${
              active.tone === "danger"
                ? "border-expense/40 bg-surface text-text"
                : "border-line bg-surface text-text"
            }`}
          >
            {active.tone === "danger" && (
              <AlertTriangle size={16} className="shrink-0 text-expense" aria-hidden />
            )}
            <span className="min-w-0 flex-1">{active.message}</span>
            {active.action && (
              <button
                onClick={() => { active.action!.onClick(); dismiss(); }}
                className="shrink-0 rounded-md px-2 py-1 font-semibold text-brand hover:bg-surface2"
              >
                {active.action.label}
              </button>
            )}
            <button
              onClick={dismiss}
              className="shrink-0 rounded-md p-1 text-muted hover:bg-surface2 hover:text-text"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
