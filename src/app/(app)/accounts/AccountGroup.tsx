import Link from "next/link";
import { AlertTriangle, Pencil, Receipt, TrendingUp } from "lucide-react";
import { Dot } from "@/components/ui-bits";
import { formatUSD } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-meta";
import type { AccountDTO, SnapshotDTO } from "@/lib/queries";
import { CreditCardDetails } from "./CreditCardDetails";

export function AccountGroup({
  title,
  accounts,
  snapshots,
  onEdit,
  onSnapshot,
}: {
  title: string;
  accounts: AccountDTO[];
  snapshots: SnapshotDTO[];
  onEdit: (a: AccountDTO) => void;
  onSnapshot: (a: AccountDTO) => void;
}) {
  const total = accounts.reduce((s, a) => s + a.currentBalance, 0);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="tabular-nums font-semibold">{formatUSD(total)}</span>
      </div>
      {accounts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">No {title.toLowerCase()} yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {accounts.map((a) => {
            const lastSnap = snapshots.filter((s) => s.accountId === a.id).at(-1);
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Dot color={a.color} size={12} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {a.name}
                      {a.isOverdue && (
                        <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-[11px] font-semibold text-expense">
                          <AlertTriangle size={11} /> overdue
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {ACCOUNT_TYPE_LABELS[a.type]}
                      {a.institution ? ` · ${a.institution}` : ""}
                      {a.includeInCash ? " · in cash flow" : ""}
                      {!a.includeInNetWorth ? " · not in net worth" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums font-semibold">{formatUSD(a.currentBalance)}</p>
                    {a.creditLimit ? (
                      <p className="text-[11px] text-muted">
                        {Math.round((a.currentBalance / a.creditLimit) * 100)}% of {formatUSD(a.creditLimit)}
                      </p>
                    ) : lastSnap ? (
                      <p className="text-[11px] text-muted">as of {lastSnap.date}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link href={`/transactions?account=${a.id}`} className="btn-ghost h-8 w-8 p-0!" title="View transactions">
                      <Receipt size={14} />
                    </Link>
                    <button onClick={() => onSnapshot(a)} className="btn-ghost h-8 w-8 p-0!" title="Update balance">
                      <TrendingUp size={14} />
                    </button>
                    <button onClick={() => onEdit(a)} className="btn-ghost h-8 w-8 p-0!" title="Edit">
                      <Pencil size={14} />
                    </button>
                  </div>
                </div>
                <CreditCardDetails account={a} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
