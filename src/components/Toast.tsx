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

// Beyond this the stack is taller than it is useful, and the oldest toast has
// been on screen long enough to have been read. The oldest is dropped first.
const MAX_VISIBLE = 3;

/**
 * App-wide toast notifications: bottom-center, newest at the bottom, each with
 * its own timer and optional action button. Toasts stack rather than replace
 * one another - a second toast used to evict the first, and with it an Undo the
 * user hadn't had a chance to click. Auto-dismisses; respects
 * prefers-reduced-motion via the global CSS transition override.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: ToastOptions) => {
    const id = ++nextId.current;
    setToasts((cur) => {
      const next = [...cur, { ...opts, id }];
      // Drop the overflow's timers too, or they'd fire against nothing.
      for (const stale of next.slice(0, Math.max(0, next.length - MAX_VISIBLE))) {
        const timer = timers.current.get(stale.id);
        if (timer) clearTimeout(timer);
        timers.current.delete(stale.id);
      }
      return next.slice(-MAX_VISIBLE);
    });
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setToasts((cur) => cur.filter((t) => t.id !== id));
      }, opts.durationMs ?? 6000),
    );
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.tone === "danger" ? "alert" : "status"}
              className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-floating animate-[toast-in_180ms_ease-out] ${
                t.tone === "danger"
                  ? "border-expense/40 bg-surface text-text"
                  : "border-line bg-surface text-text"
              }`}
            >
              {t.tone === "danger" && (
                <AlertTriangle size={16} className="shrink-0 text-expense" aria-hidden />
              )}
              <span className="min-w-0 flex-1">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                  className="shrink-0 rounded-md px-2 py-1 font-semibold text-brand hover:bg-surface2"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded-md p-1 text-muted hover:bg-surface2 hover:text-text"
                aria-label="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          ))}
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
