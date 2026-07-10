import type { TriggerDef, TriggerGroup } from "../types";
import { plaidReauth } from "./plaid-reauth";
import { syncFailing } from "./sync-failing";
import { accountStale } from "./account-stale";

export const TRIGGERS: TriggerDef[] = [plaidReauth, syncFailing, accountStale];

export const TRIGGER_BY_ID = new Map(TRIGGERS.map((t) => [t.id, t]));

export const TRIGGER_GROUPS: { id: TriggerGroup; label: string }[] = [
  { id: "connection", label: "Connection health" },
  { id: "budgets", label: "Budgets" },
  { id: "bills", label: "Bills & recurring" },
  { id: "transactions", label: "Transactions & balances" },
  { id: "digest", label: "Digest" },
];
