import type { AccountType } from "@/generated/prisma/enums";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: "Checking",
  SAVINGS: "Savings",
  CREDIT_CARD: "Credit Card",
  RETIREMENT: "Retirement",
  INVESTMENT: "Investment",
  VEHICLE: "Vehicle",
  PROPERTY: "Property",
  LOAN: "Loan",
  CASH: "Cash",
  OTHER_ASSET: "Other Asset",
  OTHER_LIABILITY: "Other Liability",
};

export const LIABILITY_TYPES: AccountType[] = ["CREDIT_CARD", "LOAN", "OTHER_LIABILITY"];

export const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string; isAsset: boolean }[] = (
  Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]
).map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t], isAsset: !LIABILITY_TYPES.includes(t) }));

/** Suggested default for whether a new account of this type counts as spendable cash. */
export function defaultIncludeInCash(type: AccountType): boolean {
  return type === "CHECKING" || type === "SAVINGS" || type === "CASH";
}
