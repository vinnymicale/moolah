"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useToast } from "./Toast";

/**
 * Manual "fetch latest bank data" button, available from any page. Forces a
 * sync of every linked bank (bypassing the hourly auto-sync throttle), then
 * refreshes the current route so new transactions/balances show up in place.
 */
export function SyncButton({ variant, compact = false }: { variant: "sidebar" | "icon"; compact?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/plaid/sync-all?force=1", { method: "POST" });
      if (!res.ok) throw new Error();
      const json = (await res.json()) as {
        synced: number; failed: number; changed: number; added: number; modified: number; removed: number;
      };
      if (json.synced === 0 && json.failed === 0) {
        toast({ message: "No linked banks to sync" });
      } else if (json.failed > 0) {
        toast({ message: `Sync finished with errors - check the Accounts page`, tone: "danger" });
      } else if (json.changed > 0) {
        const parts = [];
        if (json.added) parts.push(`${json.added} new`);
        if (json.modified) parts.push(`${json.modified} updated`);
        if (json.removed) parts.push(`${json.removed} removed`);
        toast({ message: `Banks synced - ${parts.length ? parts.join(", ") : "balances updated"}` });
      } else {
        toast({ message: "Banks synced - already up to date" });
      }
      if (json.changed > 0) router.refresh();
    } catch {
      toast({ message: "Bank sync failed", tone: "danger" });
    } finally {
      setSyncing(false);
    }
  };

  if (variant === "icon") {
    return (
      <button
        onClick={() => void sync()}
        disabled={syncing}
        className="btn-ghost h-9 w-9 p-0!"
        title="Sync bank data"
        aria-label="Sync bank data"
      >
        <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
      </button>
    );
  }

  return (
    <button
      onClick={() => void sync()}
      disabled={syncing}
      className={`btn-ghost w-full text-sm ${compact ? "justify-center px-0!" : "justify-start"}`}
      title="Fetch the latest transactions and balances from your banks"
    >
      <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> {!compact && (syncing ? "Syncing..." : "Sync banks")}
    </button>
  );
}
