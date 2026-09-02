// Shared shapes for reading versioned recurring rules.
//
// A rule's fields live on RecurringRuleVersion, so nearly every consumer needs
// the same include and the same flattening. Centralising both here keeps the
// version handling in one place instead of spread across ten call sites.

import { toNumber } from "./money";
import { currentVersion, type VersionLike } from "./recurrence";
import type { TxnType, Frequency } from "@/generated/prisma/enums";

/** Prisma include that pulls a rule's versions oldest-first. */
export const versionsInclude = {
  versions: { orderBy: { effectiveFrom: "asc" } },
} as const;

export interface RuleVersionRow extends VersionLike {
  id: string;
  effectiveFrom: Date;
  accountId: string | null;
  categoryId: string | null;
  type: TxnType;
  amount: unknown;
  note: string | null;
  frequency: Frequency;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  dayOfMonth: number | null;
  weekday: number | null;
}

export interface VersionedRuleRow {
  id: string;
  description: string;
  versions: RuleVersionRow[];
}

/** A version's fields with `amount` decoded to a number. */
export interface FlatVersion {
  versionId: string;
  effectiveFrom: Date;
  type: TxnType;
  amount: number;
  note: string | null;
  accountId: string | null;
  categoryId: string | null;
  frequency: Frequency;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: Date;
  endDate: Date | null;
}

export function flattenVersion(v: RuleVersionRow): FlatVersion {
  return {
    versionId: v.id,
    effectiveFrom: v.effectiveFrom,
    type: v.type,
    amount: toNumber(v.amount as Parameters<typeof toNumber>[0]),
    note: v.note,
    accountId: v.accountId,
    categoryId: v.categoryId,
    frequency: v.frequency,
    interval: v.interval,
    dayOfMonth: v.dayOfMonth,
    weekday: v.weekday,
    startDate: v.startDate,
    endDate: v.endDate,
  };
}

/**
 * The rule flattened to the version in force on `asOf` - what the sites that
 * only care about a rule's present shape (budget suggestions, the chat tool,
 * the manage-rules list) want.
 */
export function flattenAsOf(rule: VersionedRuleRow, asOf: Date) {
  return {
    id: rule.id,
    description: rule.description,
    ...flattenVersion(currentVersion(rule.versions, asOf)),
  };
}

/** The date a rule's series began: the earliest version's startDate. */
export function seriesStart(rule: VersionedRuleRow): Date {
  return rule.versions[0].startDate;
}

/** The latest end: null when the newest version runs forever. */
export function seriesEnd(rule: VersionedRuleRow): Date | null {
  return rule.versions[rule.versions.length - 1].endDate;
}
