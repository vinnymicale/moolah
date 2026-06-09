import { formatUSD } from "@/lib/money";
import { daysUntilDate, formatMonthDay } from "@/lib/dates";
import type { AccountDTO } from "@/lib/queries";

export function CreditCardDetails({ account }: { account: AccountDTO }) {
  const hasCreditData = account.lastStatementBalance !== null || account.nextPaymentDueDate !== null || account.lastPaymentAmount !== null;
  if (!hasCreditData) return null;

  const daysUntilDue = account.nextPaymentDueDate ? daysUntilDate(account.nextPaymentDueDate) : null;

  return (
    <div className="ml-5 mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
      {account.lastStatementBalance !== null && (
        <span>
          Statement: <span className="font-medium text-text">{formatUSD(account.lastStatementBalance)}</span>
          {account.lastStatementDate && <span className="ml-1">({formatMonthDay(account.lastStatementDate)})</span>}
        </span>
      )}
      {account.minimumPayment !== null && (
        <span>Min payment: <span className="font-medium text-text">{formatUSD(account.minimumPayment)}</span></span>
      )}
      {daysUntilDue !== null && (
        <span className={account.isOverdue ? "font-semibold text-expense" : daysUntilDue >= 0 ? "text-warning" : ""}>
          Due: {account.nextPaymentDueDate && formatMonthDay(account.nextPaymentDueDate)}
          {account.isOverdue ? " (past due)" : daysUntilDue < 0 ? " (paid)" : ` (${daysUntilDue}d)`}
        </span>
      )}
      {account.lastPaymentAmount !== null && account.lastPaymentDate !== null && (
        <span>Last payment: <span className="font-medium text-text">{formatUSD(account.lastPaymentAmount)}</span> on {formatMonthDay(account.lastPaymentDate)}</span>
      )}
    </div>
  );
}
