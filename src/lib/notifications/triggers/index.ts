import type { TriggerDef, TriggerGroup } from "../types";
import { plaidReauth } from "./plaid-reauth";
import { syncFailing } from "./sync-failing";
import { accountStale } from "./account-stale";
import { budgetExceeded } from "./budget-exceeded";
import { budgetThreshold } from "./budget-threshold";
import { budgetPace } from "./budget-pace";
import { billDue } from "./bill-due";
import { ccDue } from "./cc-due";
import { recurringPriceChange } from "./recurring-price-change";
import { recurringMissing } from "./recurring-missing";
import { largeTransaction } from "./large-transaction";
import { newMerchant } from "./new-merchant";
import { lowBalance } from "./low-balance";
import { ccUtilization } from "./cc-utilization";
import { incomeReceived } from "./income-received";

export const TRIGGERS: TriggerDef[] = [
  plaidReauth, syncFailing, accountStale,
  budgetExceeded, budgetThreshold, budgetPace,
  billDue, ccDue, recurringPriceChange, recurringMissing,
  largeTransaction, newMerchant, lowBalance, ccUtilization, incomeReceived,
];

export const TRIGGER_BY_ID = new Map(TRIGGERS.map((t) => [t.id, t]));

export const TRIGGER_GROUPS: { id: TriggerGroup; label: string }[] = [
  { id: "connection", label: "Connection health" },
  { id: "budgets", label: "Budgets" },
  { id: "bills", label: "Bills & recurring" },
  { id: "transactions", label: "Transactions & balances" },
  { id: "digest", label: "Digest" },
];
