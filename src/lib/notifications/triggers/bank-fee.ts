import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef, TriggerEvent } from "../types";

const DEFAULT_KEYWORDS = "interest,atm fee,overdraft,foreign transaction,service charge,late fee";

export const bankFee: TriggerDef = {
  id: "bank-fee",
  label: "Bank or card fee charged",
  description: "A new expense whose description matches your fee keywords.",
  group: "transactions",
  modes: ["event"],
  severity: "warning",
  paramsSchema: z.object({ keywords: z.string().default(DEFAULT_KEYWORDS) }),
  paramFields: [
    { key: "keywords", label: "Keywords (comma-separated)", kind: "text",
      help: "Matched case-insensitively against the transaction description." },
  ],
  variables: [
    { name: "merchant", description: "Transaction description" },
    { name: "amount", description: "Fee amount" },
    { name: "account", description: "Account name" },
    { name: "matched", description: "The keyword that matched" },
  ],
  defaultTemplate: {
    title: "Fee charged: {{merchant}}",
    body: "{{merchant}} charged {{amount}} on {{account}} (matched \"{{matched}}\").",
  },
  sampleVars: { merchant: "ATM Fee - Chase", amount: "$3.00", account: "Checking", matched: "atm fee" },
  async evaluate(ctx) {
    const { keywords } = ctx.params as { keywords: string };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const terms = keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
    if (terms.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId, deletedAt: null, isTransfer: false, type: "EXPENSE",
      },
      select: { id: true, description: true, amount: true, account: { select: { name: true } } },
    });
    const events: TriggerEvent[] = [];
    for (const t of txns) {
      const lower = t.description.toLowerCase();
      const matched = terms.find((term) => lower.includes(term));
      if (!matched) continue;
      events.push({
        dedupeKey: `bank-fee:${t.id}`,
        vars: {
          merchant: t.description,
          amount: formatUSD(toNumber(t.amount)),
          account: t.account?.name ?? "Unlinked",
          matched,
        },
      });
    }
    return events;
  },
};
