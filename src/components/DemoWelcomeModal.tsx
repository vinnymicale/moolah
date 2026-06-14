"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { useIsHydrated } from "@/lib/usePersistentState";

const GITHUB_URL = "https://github.com/vinnymicale/moolah";

/**
 * Welcome shown on the live demo. Points people at the GitHub project and notes
 * the persistent link in the sidebar. Only mounted in demo mode by AppChrome.
 *
 * It appears on every full page load/refresh that lands on the dashboard, but
 * NOT when the user navigates to another page and back. AppChrome is a long-
 * lived client component, so `initialPath` - captured once at its mount - is the
 * route the browser actually loaded; a real reload remounts and re-runs this,
 * while client-side navigation back to "/" does not. There's deliberately no
 * localStorage flag: a fresh reload should show it again.
 */
export function DemoWelcomeModal({ initialPath }: { initialPath: string }) {
  // Gate on hydration so SSR/first paint renders nothing (no flash, no mismatch).
  const hydrated = useIsHydrated();
  const [dismissed, setDismissed] = useState(false);

  const open = hydrated && initialPath === "/" && !dismissed;

  return (
    <Modal open={open} onClose={() => setDismissed(true)} title="Welcome to the Moolah demo" widthClass="max-w-md">
      <div className="space-y-4 text-sm text-muted">
        <p>
          You&apos;re looking at a live demo. Feel free to click around - changes
          are local only and reset on refresh.
        </p>
        <p>
          Moolah is open source. Check out the project, the setup instructions,
          and the code on GitHub:
        </p>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary w-full justify-center"
        >
          <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          View the project on GitHub
        </a>
        <p className="text-xs">
          You can reopen this link any time from the GitHub button at the bottom
          of the sidebar.
        </p>
      </div>
    </Modal>
  );
}
