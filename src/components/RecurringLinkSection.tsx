"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Link2, Loader2 } from "lucide-react";
import { describeFrequency } from "@/lib/recurrence";
import { getTransactionLinkOptionsAction, type LinkableRule } from "@/actions/recurring";
import type { TxnType } from "@/generated/prisma/enums";

/** The user's staged link choice. null means "leave the link alone". */
export type PendingLink = { ruleId: string | null; alsoMatching: boolean } | null;

export function RecurringLinkSection({
  transactionId,
  linkedRuleId,
  type,
  savedType,
  recurring,
  onRecurringChange,
  pendingLink,
  onPendingLinkChange,
  children,
}: {
  transactionId: string | null;
  linkedRuleId: string | null;
  /** The type currently selected in the form. */
  type: TxnType;
  /** The type stored on the transaction, which is what the server keys rules off. */
  savedType: TxnType | null;
  recurring: boolean;
  onRecurringChange: (v: boolean) => void;
  pendingLink: PendingLink;
  onPendingLinkChange: (v: PendingLink) => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<LinkableRule[] | null>(null);
  const [linkedRule, setLinkedRule] = useState<LinkableRule | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();

  // Rules load the first time the picker opens rather than on mount: three of
  // the modal's four call sites are add-flows that never need them.
  const load = () => {
    if (rules || !transactionId) return;
    start(async () => {
      const res = await getTransactionLinkOptionsAction(transactionId);
      if (!res.ok) return setError(res.error);
      setRules(res.rules);
      setMatchCount(res.matchCount);
      setLinkedRule(res.linked);
    });
  };

  // A transaction that is already linked names its series up front, so those
  // rules are needed on mount rather than when the picker opens.
  useEffect(() => {
    if (linkedRuleId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRuleId, transactionId]);

  const openPicker = () => {
    setOpen(true);
    load();
  };

  // The server picks rules by the transaction's stored type, so once the form
  // type is switched the loaded rules are the wrong kind and a refetch would
  // return that same wrong kind. Hide the picker until the type is saved.
  const typeChanged = savedType !== null && savedType !== type;

  const linked = linkedRuleId ?? null;
  const chosen = pendingLink ? pendingLink.ruleId : linked;
  // linkedRule covers the case where the current rule isn't in the pickable
  // list, so an archived series still shows its name instead of "a recurring series".
  const chosenRule = rules?.find((r) => r.id === chosen) ?? (chosen && chosen === linkedRule?.id ? linkedRule : undefined);

  const pick = (ruleId: string) =>
    onPendingLinkChange(ruleId ? { ruleId, alsoMatching: false } : null);

  // An unsaved transaction has no id to link, so only offer the create path.
  if (!transactionId) {
    return (
      <div className="rounded-lg border border-line p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={recurring} onChange={(e) => onRecurringChange(e.target.checked)} />
          Make this recurring
        </label>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      {linked && !pendingLink && (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-sm">
            Part of{" "}
            {chosenRule ? (
              <>
                <Link
                  href={`/transactions?range=12m&recurring=${chosenRule.id}`}
                  className="font-medium underline decoration-line underline-offset-2 hover:text-brand"
                  title="View every transaction in this series"
                >
                  {chosenRule.description}
                </Link>
                <span className="text-muted"> · {describeFrequency(chosenRule.frequency, chosenRule.interval)}</span>
              </>
            ) : (
              <span className="font-medium">a recurring series</span>
            )}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={openPicker} className="btn-ghost h-8 text-xs">Change</button>
            <button
              type="button"
              onClick={() => onPendingLinkChange({ ruleId: null, alsoMatching: false })}
              className="btn-ghost h-8 text-xs"
            >
              Unlink
            </button>
          </div>
        </div>
      )}

      {linked && pendingLink?.ruleId === null && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted">Will be unlinked from its recurring rule on save.</p>
          <button type="button" onClick={() => onPendingLinkChange(null)} className="btn-ghost h-8 text-xs">
            Undo
          </button>
        </div>
      )}

      {linked && pendingLink?.ruleId && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted">
            Will be moved to{" "}
            <span className="font-medium text-text">{chosenRule?.description ?? "the chosen rule"}</span> on save.
          </p>
          <button
            type="button"
            onClick={() => {
              onPendingLinkChange(null);
              setOpen(false);
            }}
            className="btn-ghost h-8 text-xs"
          >
            Undo
          </button>
        </div>
      )}

      {!linked && (
        <>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => {
                onRecurringChange(e.target.checked);
                // Converting and linking both write recurringRuleId, so turning
                // one on drops whatever the other had staged.
                if (e.target.checked) {
                  setOpen(false);
                  onPendingLinkChange(null);
                }
              }}
            />
            Make this recurring
          </label>
          {children}
          {!recurring && !open && !typeChanged && (
            <p className="flex items-center gap-2 text-xs text-muted">
              or
              <button type="button" onClick={openPicker} className="btn-ghost h-8 gap-1.5 px-3 text-xs">
                <Link2 size={13} /> link to an existing rule
              </button>
            </p>
          )}
        </>
      )}

      {typeChanged && (
        <p className="text-xs text-muted">
          Save the change from {savedType === "EXPENSE" ? "expense" : "income"} to{" "}
          {type === "EXPENSE" ? "expense" : "income"} before linking to a recurring rule.
        </p>
      )}

      {open && !recurring && !typeChanged && (
        <div className="space-y-2 rounded-lg bg-surface2 px-3 py-2">
          {loading && (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={13} className="animate-spin" /> Loading rules…
            </p>
          )}

          {!loading && rules?.length === 0 && (
            <p className="text-xs text-muted">
              No {type === "EXPENSE" ? "expense" : "income"} rules yet. Create one on the Recurring page first.
            </p>
          )}

          {!loading && !!rules?.length && (
            <>
              <select
                className="input h-8 w-full text-xs"
                value={chosen ?? ""}
                aria-label="Choose a recurring rule"
                onChange={(e) => pick(e.target.value)}
              >
                <option value="" disabled>Choose a rule…</option>
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.description} · {describeFrequency(r.frequency, r.interval)}
                  </option>
                ))}
              </select>

              {!linked && pendingLink?.ruleId && matchCount > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={pendingLink.alsoMatching}
                    onChange={(e) =>
                      onPendingLinkChange({ ruleId: pendingLink.ruleId, alsoMatching: e.target.checked })
                    }
                  />
                  Also link {matchCount} other transaction{matchCount === 1 ? "" : "s"} matching this description
                </label>
              )}
            </>
          )}

          {error && <p className="text-xs text-expense">{error}</p>}
        </div>
      )}
    </div>
  );
}
