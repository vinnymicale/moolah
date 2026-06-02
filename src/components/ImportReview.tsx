"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileWarning, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { parseBankCsv, type ParseResult } from "@/lib/csv-import";
import { analyzeImportAction, commitImportAction, type AnalyzedRow } from "@/actions/import";
import type { AccountDTO, CategoryDTO } from "@/lib/queries";

type TxType = "INCOME" | "EXPENSE";

interface EditableRow {
  include: boolean;
  date: string;
  description: string;
  amount: string;
  type: TxType;
  categoryId: string;
  duplicate: boolean;
  duplicateReason: string | null;
}

type Phase = "loading" | "review" | "empty" | "error" | "done";

export interface ImportReviewProps {
  open: boolean;
  onClose: () => void;
  /** Raw CSV text to import. */
  csvText: string | null;
  filename?: string;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
}

export function ImportReview({ open, onClose, csvText, filename, accounts, categories }: ImportReviewProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [importedCount, setImportedCount] = useState(0);
  const [pending, start] = useTransition();

  // Analyze whenever a new CSV is supplied. All state updates live inside the
  // async closure so they run after the effect commits, not synchronously.
  useEffect(() => {
    if (!open || !csvText) return;
    let cancelled = false;

    (async () => {
      setPhase("loading");
      setError(null);
      setAccountId(accounts.find((a) => a.includeInCash)?.id ?? accounts[0]?.id ?? "");

      const result = parseBankCsv(csvText);
      if (cancelled) return;
      setParsed(result);

      if (result.rows.length === 0) {
        setPhase("empty");
        return;
      }

      const res = await analyzeImportAction(result.rows);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setPhase("error");
        return;
      }
      setRows(res.rows.map(toEditable));
      setPhase("review");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, csvText, accounts]);

  const includedCount = rows.filter((r) => r.include).length;
  const dupCount = rows.filter((r) => r.duplicate).length;
  const catOptions = useMemo(
    () => ({
      INCOME: categories.filter((c) => c.kind === "INCOME"),
      EXPENSE: categories.filter((c) => c.kind === "EXPENSE"),
    }),
    [categories],
  );

  const patch = (i: number, p: Partial<EditableRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const setAll = (include: boolean) => setRows((prev) => prev.map((r) => ({ ...r, include })));

  const submit = () =>
    start(async () => {
      setError(null);
      const selected = rows.filter((r) => r.include);
      const payload = selected.map((r) => ({
        date: r.date,
        description: r.description.trim() || "Imported transaction",
        amount: Number(r.amount),
        type: r.type,
        categoryId: r.categoryId || null,
      }));
      const bad = payload.find((p) => !(p.amount > 0));
      if (bad) {
        setError("Every selected row needs an amount greater than zero.");
        return;
      }
      const res = await commitImportAction({ rows: payload, accountId: accountId || null });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImportedCount(payload.length);
      setPhase("done");
      router.refresh();
    });

  return (
    <Modal open={open} onClose={onClose} title="Import transactions" widthClass="max-w-4xl">
      {phase === "loading" && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted">
          <Loader2 size={18} className="animate-spin" /> Reading {filename ? `“${filename}”` : "your file"}…
        </div>
      )}

      {phase === "empty" && (
        <div className="space-y-4 py-6 text-center">
          <FileWarning size={32} className="mx-auto text-warning" />
          <div>
            <p className="font-medium">No transactions found</p>
            <p className="mt-1 text-sm text-muted">
              {parsed?.format === "Unrecognised"
                ? "Couldn't recognise the columns in this file. It needs a date column and either an amount or debit/credit columns."
                : "The file parsed, but no rows had a usable date and amount."}
            </p>
          </div>
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-4 py-6 text-center">
          <AlertTriangle size={32} className="mx-auto text-expense" />
          <p className="text-sm text-expense">{error}</p>
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      )}

      {phase === "done" && (
        <div className="space-y-4 py-8 text-center">
          <CheckCircle2 size={36} className="mx-auto text-income" />
          <p className="font-medium">Imported {importedCount} transaction{importedCount === 1 ? "" : "s"}.</p>
          <button onClick={onClose} className="btn-primary">Done</button>
        </div>
      )}

      {phase === "review" && (
        <div className="space-y-4">
          {/* Summary + account selector */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="text-sm text-muted">
              <p>
                <span className="font-medium text-text">{parsed?.rows.length}</span> rows parsed
                {parsed?.format ? ` · ${parsed.format}` : ""}
                {dupCount > 0 ? ` · ${dupCount} likely duplicate${dupCount === 1 ? "" : "s"} unchecked` : ""}
              </p>
              {parsed && parsed.skipped.length > 0 && (
                <p className="text-warning">{parsed.skipped.length} line(s) skipped (unreadable date/amount).</p>
              )}
            </div>
            <div className="min-w-48">
              <label className="label">Add to account</label>
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">No account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <button onClick={() => setAll(true)} className="text-brand hover:underline">Select all</button>
            <button onClick={() => setAll(false)} className="text-brand hover:underline">Select none</button>
          </div>

          {/* Rows */}
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface2 text-left text-xs text-muted">
                <tr>
                  <th className="w-10 p-2"></th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Description</th>
                  <th className="w-24 p-2">Type</th>
                  <th className="w-28 p-2 text-right">Amount</th>
                  <th className="p-2">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={i} className={r.include ? "" : "opacity-50"}>
                    <td className="p-2 align-top">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => patch(i, { include: e.target.checked })}
                        aria-label="Include this transaction"
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        type="date"
                        className="input h-8 px-2 py-1 text-xs"
                        value={r.date}
                        onChange={(e) => patch(i, { date: e.target.value })}
                      />
                      {r.duplicate && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-warning">
                          <AlertTriangle size={11} /> {r.duplicateReason}
                        </span>
                      )}
                    </td>
                    <td className="p-2 align-top">
                      <input
                        className="input h-8 px-2 py-1 text-xs"
                        value={r.description}
                        onChange={(e) => patch(i, { description: e.target.value })}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <select
                        className="input h-8 px-2 py-1 text-xs"
                        value={r.type}
                        onChange={(e) => patch(i, { type: e.target.value as TxType, categoryId: "" })}
                      >
                        <option value="EXPENSE">Expense</option>
                        <option value="INCOME">Income</option>
                      </select>
                    </td>
                    <td className="p-2 align-top">
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
                        <input
                          className="input h-8 pl-5 pr-2 py-1 text-right text-xs tabular-nums"
                          inputMode="decimal"
                          value={r.amount}
                          onChange={(e) => patch(i, { amount: e.target.value })}
                        />
                      </div>
                    </td>
                    <td className="p-2 align-top">
                      <select
                        className="input h-8 px-2 py-1 text-xs"
                        value={r.categoryId}
                        onChange={(e) => patch(i, { categoryId: e.target.value })}
                      >
                        <option value="">Uncategorized</option>
                        {catOptions[r.type].map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="text-sm text-expense">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={submit} disabled={pending || includedCount === 0} className="btn-primary">
              {pending ? "Importing…" : `Import ${includedCount} transaction${includedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function toEditable(r: AnalyzedRow): EditableRow {
  return {
    include: !r.duplicate,
    date: r.date,
    description: r.description,
    amount: r.amount.toFixed(2),
    type: r.type,
    categoryId: r.suggestedCategoryId ?? "",
    duplicate: r.duplicate,
    duplicateReason: r.duplicateReason,
  };
}
