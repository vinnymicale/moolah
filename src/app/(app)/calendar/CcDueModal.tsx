import { Modal } from "@/components/Modal";
import { formatUSD } from "@/lib/money";
import type { CcDueEvent } from "@/lib/calendar";
import { daysUntilDate, formatDayLabel } from "./calendar-utils";

export function CcDueModal({ due, onClose }: { due: CcDueEvent; onClose: () => void }) {
  const daysUntil = daysUntilDate(due.dueDate);
  const pastDue = due.isOverdue === true;
  return (
    <Modal open onClose={onClose} title={`${due.accountName} - Payment Due`} widthClass="max-w-sm">
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <p className="text-xs text-muted">Due date</p>
          <p className="font-semibold">{formatDayLabel(due.dueDate)}</p>
          <p className={`text-xs ${pastDue ? "text-expense font-semibold" : daysUntil <= 3 && daysUntil >= 0 ? "text-expense" : "text-muted"}`}>
            {pastDue ? "Past due" : daysUntil < 0 ? "Paid" : daysUntil === 0 ? "Due today" : `${daysUntil} day${daysUntil === 1 ? "" : "s"} away`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {due.statementBalance !== null && (
            <div className="rounded-lg bg-surface2 px-3 py-2">
              <p className="text-xs text-muted">Statement balance</p>
              <p className="tabular-nums font-semibold text-expense">{formatUSD(due.statementBalance)}</p>
            </div>
          )}
          {due.minimumPayment !== null && (
            <div className="rounded-lg bg-surface2 px-3 py-2">
              <p className="text-xs text-muted">Minimum payment</p>
              <p className="tabular-nums font-semibold">{formatUSD(due.minimumPayment)}</p>
            </div>
          )}
        </div>
        <button onClick={onClose} className="btn-ghost w-full">Close</button>
      </div>
    </Modal>
  );
}
