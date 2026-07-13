"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { Link2, Loader2, AlertTriangle, RefreshCw, Trash2, Building2, DownloadCloud, Copy } from "lucide-react";
import { formatUSD } from "@/lib/money";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { PlaidItemDTO } from "@/lib/queries";
import {
  scanDuplicateTransactionsAction,
  removeDuplicateTransactionsAction,
  ignoreDuplicateGroupAction,
} from "@/actions/transactions";
import type { DedupScan, DuplicateGroup } from "@/lib/dedup-transactions";
import { useConfirmAction } from "@/lib/useConfirmAction";

// Owns the single usePlaidLink instance for the page. Only mounted when we
// have an active token, so the Plaid script is never embedded more than once.
function ActivePlaidLink({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: PlaidLinkOnSuccess;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}

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

  const onExit = useCallback(() => setLinkToken(null), []);

  return (
    <div>
      {linkToken && <ActivePlaidLink token={linkToken} onSuccess={onSuccess} onExit={onExit} />}
      <button
        onClick={fetchLinkToken}
        disabled={loading}
        className="btn-primary"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
        Connect a bank
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-expense">{error}</p>
      )}
    </div>
  );
}

// ── Reconnect button (update mode for an existing item) ──────────────────────

function ReconnectButton({ itemId, disabled }: { itemId: string; disabled: boolean }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const fetchLinkToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const json = await res.json() as { link_token?: string; error?: string };
      if (!res.ok || !json.link_token) throw new Error(json.error ?? "Failed to create link token");
      setLinkToken(json.link_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to initialise Plaid");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  // In update mode the existing access token stays valid and the public token
  // must NOT be exchanged (that would error and never clear the item's error
  // state). A successful re-auth just needs a fresh sync.
  const onSuccess: PlaidLinkOnSuccess = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plaid/sync/${itemId}`, { method: "POST" });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Sync after reconnect failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconnect failed");
    } finally {
      setLoading(false);
      setLinkToken(null);
    }
  }, [router, itemId]);

  const onExit = useCallback(() => setLinkToken(null), []);

  return (
    <div>
      {linkToken && <ActivePlaidLink token={linkToken} onSuccess={onSuccess} onExit={onExit} />}
      <button
        onClick={fetchLinkToken}
        disabled={disabled || loading}
        className="btn-ghost h-8 text-xs"
        title="Re-authenticate this bank connection"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
        Reconnect
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-expense">{error}</p>}
    </div>
  );
}

// ── Connected banks list ─────────────────────────────────────────────────────

export function PlaidItemsList({ items }: { items: PlaidItemDTO[] }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<PlaidItemDTO | null>(null);
  const [confirmReimport, setConfirmReimport] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const [dedupOpen, setDedupOpen] = useState(false);
  const [, start] = useTransition();
  const { toast } = useToast();

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

  // Re-pull full history for every connected bank. Recovers transactions that
  // were deleted locally without creating any new Plaid connection.
  const reimportAll = async () => {
    setConfirmReimport(false);
    setReimporting(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/reimport-all", { method: "POST" });
      const json = await res.json() as { ok?: boolean; error?: string; added?: number; failed?: number };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Re-import failed");
      const added = json.added ?? 0;
      toast({
        message: added > 0
          ? `Re-import complete. Restored ${added} transaction${added === 1 ? "" : "s"} that were missing.`
          : "Re-import complete. Everything was already up to date.",
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-import failed");
    } finally {
      setReimporting(false);
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

  if (items.length === 0) return null;

  return (
    <div className="card mt-6 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Building2 size={18} className="text-brand" />
        <h2 className="font-semibold">Connected banks</h2>
        <button
          onClick={() => setDedupOpen(true)}
          className="btn-ghost ml-auto h-8 text-xs"
          title="Find and remove duplicate transactions"
        >
          <Copy size={14} />
          Find duplicates
        </button>
        <button
          onClick={() => setConfirmReimport(true)}
          disabled={reimporting}
          className="btn-ghost h-8 text-xs"
          title="Re-pull all transactions from your connected banks"
        >
          {reimporting ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
          Re-import all
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 border-b border-expense/30 bg-expense/5 px-4 py-2 text-sm text-expense">
          <AlertTriangle size={14} aria-hidden /> {error}
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
                <ReconnectButton itemId={item.id} disabled={syncing === item.id || disconnecting === item.id} />
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
                  aria-label={`Disconnect ${item.institutionName ?? "bank"}`}
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
                    <span className="shrink-0 money text-sm font-semibold">
                      {acct.currentBalance !== null ? formatUSD(acct.currentBalance) : "-"}
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

      {confirmReimport && (
        <Modal open onClose={() => setConfirmReimport(false)} title="Re-import all transactions?" widthClass="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This re-pulls the full history from every connected bank using the
              links you already have - it won&apos;t add a new connection. Existing
              transactions are matched and updated in place, so nothing is
              duplicated. Anything that was deleted but still exists at your bank
              comes back.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmReimport(false)} className="btn-ghost">Cancel</button>
              <button onClick={() => void reimportAll()} className="btn-primary">
                Re-import all
              </button>
            </div>
          </div>
        </Modal>
      )}

      {dedupOpen && (
        <DedupModal
          onClose={() => setDedupOpen(false)}
          onChanged={() => router.refresh()}
        />
      )}

      {confirmDisconnect && (
        <Modal open onClose={() => setConfirmDisconnect(null)} title="Disconnect bank?" widthClass="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This removes the Plaid connection to <strong>{confirmDisconnect.institutionName ?? "this bank"}</strong>. Your existing accounts and transactions are kept - only the live sync link is removed.
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

// ── Duplicate finder ─────────────────────────────────────────────────────────

// Scans for transactions that share an account, date, amount, type, and
// description but exist as more than one row - the trail left by a re-import
// that re-created charges the bank handed back under a fresh id. The oldest
// copy in each group is kept. Not every match is a mistake - a charge can
// legitimately hit twice on the same day - so each row can be ignored instead,
// and the remove buttons only touch the rows still checked.
function DedupModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [scan, setScan] = useState<DedupScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    scanDuplicateTransactionsAction()
      .then((r) => {
        if (!active) return;
        setScan(r);
        // Everything starts checked: the common case is that all of them really
        // are duplicates, and unchecking is the exception.
        setSelected(new Set(r.groups.map((g) => g.keepId)));
      })
      .catch(() => { if (active) setError("Couldn't scan for duplicates."); });
    return () => { active = false; };
  }, []);

  const toggle = (keepId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keepId)) next.delete(keepId);
      else next.add(keepId);
      return next;
    });
  };

  // Copies that would be removed by the buttons right now: the checked groups
  // only. Drives the button labels so the scope is never a guess.
  const selectedCount = (scan?.groups ?? [])
    .filter((g) => selected.has(g.keepId))
    .reduce((n, g) => n + g.removeIds.length, 0);

  const ignore = async (g: DuplicateGroup) => {
    setBusy(true);
    setError(null);
    const res = await ignoreDuplicateGroupAction([g.keepId, ...g.removeIds]);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't ignore that charge.");
      return;
    }
    // Drop it from the list in place - re-scanning would just rebuild the same
    // list minus this row, and it would lose the user's other checkboxes.
    setScan((prev) =>
      prev
        ? {
            groups: prev.groups.filter((x) => x.keepId !== g.keepId),
            removableCount: prev.removableCount - g.removeIds.length,
          }
        : prev,
    );
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(g.keepId);
      return next;
    });
    onChanged();
  };

  const remove = async (mode: "soft" | "hard") => {
    setBusy(true);
    setError(null);
    const removed = selectedCount;
    const res = await removeDuplicateTransactionsAction(mode, [...selected]);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't remove the duplicates.");
      return;
    }
    setScan({ groups: [], removableCount: 0 });
    setSelected(new Set());
    setDone(
      mode === "hard"
        ? `Deleted ${removed} duplicate${removed === 1 ? "" : "s"}.`
        : `Moved ${removed} duplicate${removed === 1 ? "" : "s"} to the trash.`,
    );
    onChanged();
  };

  // Bulk hard-delete can drop many rows at once, so it gets the same two-click
  // arm-then-confirm guard used for single-row purges in the trash.
  const confirmHardDelete = useConfirmAction(() => void remove("hard"));

  return (
    <Modal open onClose={onClose} title="Find duplicate transactions" widthClass="max-w-lg">
      <div className="space-y-4">
        {scan === null && !error ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" /> Scanning…
          </p>
        ) : done ? (
          <p className="py-6 text-center text-sm text-muted">{done}</p>
        ) : scan && scan.removableCount === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No duplicates found.</p>
        ) : scan ? (
          <>
            <p className="text-sm text-muted">
              Found <strong>{scan.removableCount}</strong> extra cop
              {scan.removableCount === 1 ? "y" : "ies"} across {scan.groups.length} charge
              {scan.groups.length === 1 ? "" : "s"}. The oldest copy of each is always kept.
              Uncheck a charge to leave it alone, or ignore it if both copies are real and you
              never want it flagged again.
            </p>
            <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
              {scan.groups.map((g) => (
                <li
                  key={g.keepId}
                  className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(g.keepId)}
                    onChange={() => toggle(g.keepId)}
                    disabled={busy}
                    aria-label={`Remove extra copies of ${g.description || "this charge"}`}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{g.description || "(no description)"}</p>
                    <p className="truncate text-xs text-muted">
                      {[g.date, g.accountName].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className={`shrink-0 money ${g.type === "INCOME" ? "text-income" : "text-expense"}`}>
                    {g.type === "INCOME" ? "+" : "−"}{formatUSD(g.amount)}
                  </span>
                  <span className="shrink-0 text-xs text-muted">×{g.removeIds.length + 1}</span>
                  <button
                    onClick={() => void ignore(g)}
                    disabled={busy}
                    title="Both charges are real - stop flagging this"
                    className="btn-ghost shrink-0 text-xs"
                  >
                    Ignore
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {error && <p role="alert" className="text-sm text-expense">{error}</p>}

        <div className="flex items-center gap-2">
          {done || (scan && scan.removableCount === 0) ? (
            <button onClick={onClose} className="btn-ghost ml-auto">Done</button>
          ) : scan && scan.removableCount > 0 ? (
            <>
              <button onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
              <button
                onClick={() => void remove("soft")}
                disabled={busy || selectedCount === 0}
                title="Removes the extra copies but keeps them in the trash, so you can restore them"
                className="btn-ghost ml-auto"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Move {selectedCount} to trash
              </button>
              <button
                onClick={confirmHardDelete.trigger}
                disabled={busy || selectedCount === 0}
                title="Deletes the extra copies outright - this cannot be undone"
                className="btn-danger"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {confirmHardDelete.armed
                  ? "Click to confirm"
                  : `Delete ${selectedCount} permanently`}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
