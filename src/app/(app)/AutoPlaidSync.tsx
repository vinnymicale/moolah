"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Module-level guard so this fires at most once per page session (and not twice
// under React StrictMode in dev). The server endpoint additionally throttles by
// each item's lastSyncedAt, so calling it is cheap and safe.
let fired = false;

/**
 * Fires a background "sync all stale banks" when the app loads, then refreshes
 * the route if anything actually changed. Renders nothing. Mounted once in the
 * app layout, so it runs on visit/reload - not on every client-side navigation.
 */
export function AutoPlaidSync() {
  const router = useRouter();

  useEffect(() => {
    if (fired) return;
    fired = true;
    (async () => {
      try {
        const res = await fetch("/api/plaid/sync-all", { method: "POST" });
        if (!res.ok) return;
        const json = (await res.json()) as { changed?: number };
        if (json.changed && json.changed > 0) router.refresh();
      } catch {
        // best-effort background sync; ignore failures
      }
    })();
  }, [router]);

  return null;
}
