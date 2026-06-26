"use client";

import { useEffect, useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useConfirmAction } from "@/lib/useConfirmAction";
import {
  listDeletedTransactionsAction,
  restoreTransactionAction,
  permanentDeleteTransactionAction,
} from "@/actions/transactions";
import type { AccountDTO, CategoryDTO, DeletedTransactionDTO } from "@/lib/queries";
import { formatUSD } from "@/lib/money";
import { formatMonthDayYear } from "@/lib/dates";

export function TrashDrawer({
  open,
  onClose,
  accounts,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
}) {
  // rows holds the fetched list; loadId rises each time the drawer opens so a
  // stale fetch from a prior open can't overwrite a newer one. rows === null
  // while a load is in flight.
  const [rows, setRows] = useState<DeletedTransactionDTO[] | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();

  const acctById = new Map(accounts.map((a) => [a.id, a.name]));
  const catById = new Map(categories.map((c) => [c.id, c.name]));

  // Refetch each time the drawer opens so it reflects deletes made since. The
  // reset to the loading state happens in the cleanup of the previous run, not
  // synchronously in this effect body.
  useEffect(() => {
    if (!open) return;
    let active = true;
    listDeletedTransactionsAction().then((r) => {
      if (active) setRows(r);
    });
    return () => {
      active = false;
      setRows(null);
    };
  }, [open]);

  const restore = (id: string) =>
    start(async () => {
      const res = await restoreTransactionAction(id);
      if (!res.ok) {
        toast({ message: res.error ?? "Couldn't restore that transaction.", tone: "danger" });
        return;
      }
      setRows((cur) => cur?.filter((r) => r.id !== id) ?? cur);
      toast({ message: "Transaction restored." });
    });

  return (
    <Modal open={open} onClose={onClose} title="Recently deleted">
      <p className="mb-3 text-sm text-muted">
        Deleted transactions stay here so you can put them back. Removing one
        permanently can&apos;t be undone.
      </p>

      {rows === null ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Nothing in the trash.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
          {rows.map((r) => (
            <TrashRow
              key={r.id}
              row={r}
              accountName={r.accountId ? acctById.get(r.accountId) : null}
              categoryName={r.categoryId ? catById.get(r.categoryId) : null}
              pending={pending}
              onRestore={() => restore(r.id)}
              onPurge={() =>
                start(async () => {
                  const res = await permanentDeleteTransactionAction(r.id);
                  if (!res.ok) {
                    toast({ message: res.error ?? "Couldn't remove that transaction.", tone: "danger" });
                    return;
                  }
                  setRows((cur) => cur?.filter((x) => x.id !== r.id) ?? cur);
                })
              }
            />
          ))}
        </ul>
      )}
    </Modal>
  );
}

function TrashRow({
  row,
  accountName,
  categoryName,
  pending,
  onRestore,
  onPurge,
}: {
  row: DeletedTransactionDTO;
  accountName: string | null | undefined;
  categoryName: string | null | undefined;
  pending: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const confirmPurge = useConfirmAction(onPurge);
  const meta = [formatMonthDayYear(row.date), categoryName, accountName].filter(Boolean).join(" · ");

  return (
    <li className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.description || "(no description)"}</p>
        <p className="truncate text-xs text-muted">{meta}</p>
      </div>
      <span className={`shrink-0 text-sm tabular-nums ${row.type === "INCOME" ? "text-income" : "text-expense"}`}>
        {row.type === "INCOME" ? "+" : "−"}
        {formatUSD(row.amount)}
      </span>
      <button
        onClick={onRestore}
        disabled={pending}
        className="btn-ghost h-8 shrink-0 text-xs"
        title="Restore"
      >
        <RotateCcw size={13} /> Restore
      </button>
      <button
        onClick={confirmPurge.trigger}
        disabled={pending}
        className={`btn-ghost h-8 shrink-0 text-expense ${
          confirmPurge.armed ? "text-xs font-medium" : "w-8 !p-0"
        }`}
        title={confirmPurge.armed ? "Click to permanently delete" : "Delete permanently"}
      >
        {confirmPurge.armed ? (
          <>
            <Trash2 size={13} /> Delete forever
          </>
        ) : (
          <Trash2 size={14} />
        )}
      </button>
    </li>
  );
}
