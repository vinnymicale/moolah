// Builds the alert digest: what's due soon and what's over budget. The data
// assembly (buildDigestForUser) reuses the calendar and budget queries; the
// formatting (formatDigest) is pure so it's unit-testable without a DB.

import { prisma } from "@/lib/prisma";
import { toNumber, formatUSD } from "@/lib/money";
import { isoDay, parseISODay } from "@/lib/dates";
import { getUpcoming } from "@/lib/calendar";
import { getBudgetMonth } from "@/lib/queries/budgets";

export interface DigestBill {
  date: string; // ISO day
  description: string;
  amount: number;
}

export interface DigestCardDue {
  name: string;
  dueDate: string; // ISO day
  amount: number;
  overdue: boolean;
}

export interface DigestBudget {
  name: string;
  limit: number;
  actual: number;
}

export interface Digest {
  todayISO: string;
  billsDays: number;
  bills: DigestBill[];
  cardsDue: DigestCardDue[];
  overBudget: DigestBudget[];
}

/** Gather everything the digest reports on, for one user as of `todayISO`. */
export async function buildDigestForUser(
  userId: string,
  todayISO: string,
  billsDays: number,
  budgetsEnabled: boolean,
): Promise<Digest> {
  const today = parseISODay(todayISO);
  const horizon = new Date(today.getTime() + billsDays * 86_400_000);

  const upcoming = await getUpcoming(userId, todayISO, billsDays);
  const bills: DigestBill[] = upcoming
    .filter((u) => u.type === "EXPENSE")
    .map((u) => ({ date: u.date, description: u.description, amount: u.amount }));

  // Credit-card statement due dates, same visibility rule as the calendar and
  // Safe-to-transfer: a due date today or later (within the window), or a past
  // date explicitly flagged overdue. A past date that isn't overdue usually
  // means it was paid and Plaid hasn't rolled the date forward yet.
  const cards = await prisma.financialAccount.findMany({
    where: { userId, archived: false, type: "CREDIT_CARD", nextPaymentDueDate: { not: null } },
    select: { name: true, nextPaymentDueDate: true, lastStatementBalance: true, isOverdue: true },
  });
  const cardsDue: DigestCardDue[] = [];
  for (const c of cards) {
    const due = c.nextPaymentDueDate!;
    const amount = toNumber(c.lastStatementBalance ?? 0);
    if (amount <= 0) continue;
    const overdue = due.getTime() < today.getTime();
    if (overdue && c.isOverdue !== true) continue;
    if (!overdue && due.getTime() > horizon.getTime()) continue;
    cardsDue.push({ name: c.name, dueDate: isoDay(due), amount, overdue });
  }
  cardsDue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  let overBudget: DigestBudget[] = [];
  if (budgetsEnabled) {
    const lines = await getBudgetMonth(userId, todayISO);
    overBudget = lines
      .filter((l) => l.effectiveLimit > 0 && l.actual > l.effectiveLimit)
      .map((l) => ({ name: l.name, limit: l.effectiveLimit, actual: l.actual }))
      .sort((a, b) => b.actual - b.limit - (a.actual - a.limit));
  }

  return { todayISO, billsDays, bills, cardsDue, overBudget };
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string): string {
  const d = parseISODay(iso);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Render a digest as a title plus plain-text body, or null when there is
 * nothing worth sending - an empty digest is silently skipped rather than
 * pinging the user with "all clear" every day.
 */
export function formatDigest(digest: Digest): { title: string; body: string } | null {
  const sections: string[] = [];

  if (digest.cardsDue.length > 0) {
    const lines = digest.cardsDue.map((c) =>
      c.overdue
        ? `- ${c.name}: ${formatUSD(c.amount)} was due ${shortDate(c.dueDate)} (OVERDUE)`
        : `- ${c.name}: ${formatUSD(c.amount)} due ${shortDate(c.dueDate)}`,
    );
    sections.push(`Credit cards due:\n${lines.join("\n")}`);
  }

  if (digest.bills.length > 0) {
    const lines = digest.bills.map((b) => `- ${shortDate(b.date)}: ${b.description} ${formatUSD(b.amount)}`);
    sections.push(`Upcoming bills (next ${digest.billsDays} day${digest.billsDays === 1 ? "" : "s"}):\n${lines.join("\n")}`);
  }

  if (digest.overBudget.length > 0) {
    const lines = digest.overBudget.map(
      (b) => `- ${b.name}: ${formatUSD(b.actual)} spent of ${formatUSD(b.limit)} (${formatUSD(b.actual - b.limit)} over)`,
    );
    sections.push(`Over budget this month:\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return null;

  const parts: string[] = [];
  if (digest.cardsDue.some((c) => c.overdue)) parts.push("card overdue");
  else if (digest.cardsDue.length > 0) parts.push(`${digest.cardsDue.length} card${digest.cardsDue.length === 1 ? "" : "s"} due`);
  if (digest.bills.length > 0) parts.push(`${digest.bills.length} bill${digest.bills.length === 1 ? "" : "s"} upcoming`);
  if (digest.overBudget.length > 0) parts.push(`${digest.overBudget.length} over budget`);

  return { title: `Moolah: ${parts.join(", ")}`, body: sections.join("\n\n") };
}
