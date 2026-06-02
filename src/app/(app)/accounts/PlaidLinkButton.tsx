"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { Link2, Loader2, AlertTriangle, RefreshCw, Trash2, Building2, Tag } from "lucide-react";
import { formatUSD } from "@/lib/money";
import { Modal } from "@/components/Modal";
import type { PlaidItemDTO } from "@/lib/queries";

// ── Connect button + flow ────────────────────────────────────────────────────

export function PlaidConnectButton() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const fetchLinkToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      const json = await res.json() as { link_token?: string; error?: string };
      if (!res.ok || !json.link_token) throw new Error(json.error ?? "Failed to create link token");
      setLinkToken(json.link_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to initialise Plaid Link");
    } finally {
      setLoading(false);
    }
  }, []);

  const onSuccess: PlaidLinkOnSuccess = useCallback(async (publicToken) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_token: publicToken }),
      });
      const json = await res.json() as { ok?: boolean; error?: string; institutionName?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Connection failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setLoading(false);
      setLinkToken(null);
    }
  }, [router]);

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  return (
    <div>
      <button
        onClick={fetchLinkToken}
        disabled={loading}
        className="btn-primary"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
        Connect a bank
      </button>
      {error && (
        <p className="mt-2 text-sm text-expense">{error}</p>
      )}
    </div>
  );
}

// ── Connected banks list ─────────────────────────────────────────────────────

export function PlaidItemsList({ items }: { items: PlaidItemDTO[] }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [recategorizing, setRecategorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<PlaidItemDTO | null>(null);
  const [, start] = useTransition();

  const sync = async (itemId: string) => {
    setSyncing(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/plaid/sync/${itemId}`, { method: "POST" });
      const json = await res.json() as { ok?: boolean; error?: string; added?: number; modified?: number; removed?: number };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Sync failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  const disconnect = async (item: PlaidItemDTO) => {
    setDisconnecting(item.id);
    setConfirmDisconnect(null);
    setError(null);
    try {
      const res = await fetch(`/api/plaid/item/${item.id}`, { method: "DELETE" });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Disconnect failed");
      start(() => { router.refresh(); });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(null);
    }
  };

  const recategorize = async () => {
    setRecategorizing(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/recategorize", { method: "POST" });
      const json = await res.json() as { ok?: boolean; error?: string; errors?: string[] };
      if (!res.ok || !json.ok) throw new Error(json.errors?.join(", ") ?? json.error ?? "Recategorize failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recategorize failed");
    } finally {
      setRecategorizing(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="card mt-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-brand" />
          <h2 className="font-semibold">Connected banks</h2>
        </div>
        <button
          onClick={() => void recategorize()}
          disabled={recategorizing || syncing !== null}
          className="btn-ghost h-8 text-xs"
          title="Re-check Plaid categories for all uncategorized transactions"
        >
          {recategorizing ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
          Fix categories
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-expense/30 bg-expense/5 px-4 py-2 text-sm text-expense">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-semibold">{item.institutionName ?? "Bank"}</p>
                <p className="text-xs text-muted">
                  {item.lastSyncedAt
                    ? `Last synced ${new Date(item.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                    : "Not yet synced"}
                </p>
                {item.error && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-expense">
                    <AlertTriangle size={11} /> {item.error}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void sync(item.id)}
                  disabled={syncing === item.id}
                  className="btn-ghost h-8 text-xs"
                  title="Pull latest transactions and balances"
                >
                  {syncing === item.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <RefreshCw size={14} />}
                  Sync
                </button>
                <button
                  onClick={() => setConfirmDisconnect(item)}
                  disabled={disconnecting === item.id}
                  className="btn-ghost h-8 text-xs text-muted hover:text-expense"
                  title="Remove Plaid connection"
                >
                  {disconnecting === item.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Trash2 size={14} />}
                </button>
              </div>
            </div>

            <ul className="grid gap-2 sm:grid-cols-2">
              {item.linkedAccounts.map((acct) => (
                <li key={acct.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-medium">
                      {acct.name}
                      {acct.mask ? <span className="ml-1 text-xs text-muted">·· {acct.mask}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-sm font-semibold">
                      {acct.currentBalance !== null ? formatUSD(acct.currentBalance) : "—"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted capitalize">
                    {acct.plaidSubtype ?? acct.plaidType}
                    {acct.availableBalance !== null && acct.availableBalance !== acct.currentBalance
                      ? ` · ${formatUSD(acct.availableBalance)} available`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {confirmDisconnect && (
        <Modal open onClose={() => setConfirmDisconnect(null)} title="Disconnect bank?" widthClass="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This removes the Plaid connection to <strong>{confirmDisconnect.institutionName ?? "this bank"}</strong>. Your existing accounts and transactions are kept — only the live sync link is removed.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDisconnect(null)} className="btn-ghost">Cancel</button>
              <button onClick={() => void disconnect(confirmDisconnect)} className="btn-danger">
                Disconnect
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
