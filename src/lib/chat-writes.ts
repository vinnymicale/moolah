// Staged writes for the AI assistant.
//
// The chat tool loop runs entirely inside one request, so there is no turn
// boundary where the user could approve a write mid-conversation. Instead the
// write tools stage: they validate the model's arguments and resolve the names
// it guessed into real records, but touch nothing. The route returns the staged
// descriptors alongside the reply, the user confirms in the panel, and the
// confirm endpoint commits.
//
// Two consequences worth knowing. The descriptor that comes back from the
// browser is untrusted - it round-trips through the client - so commit re-parses
// it and re-checks every id against the caller's own records. And a staged write
// only lives in the panel's state: closing the chat drops it rather than leaving
// something queued to fire later.

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories } from "@/lib/queries";
import { formatUSD } from "@/lib/money";

const isoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createTransactionArgs = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.number().positive().finite(),
  date: isoDaySchema,
  description: z.string().min(1).max(120),
  note: z.string().max(500).optional(),
  category_name: z.string().optional(),
  account_name: z.string().optional(),
  cleared: z.boolean().optional(),
});

export const createRecurringArgs = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.number().positive().finite(),
  description: z.string().min(1).max(120),
  frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.number().int().min(1).max(366).optional(),
  start_date: isoDaySchema,
  day_of_month: z.number().int().min(1).max(31).optional(),
  category_name: z.string().optional(),
  account_name: z.string().optional(),
});

export const setBudgetArgs = z.object({
  category_name: z.string().min(1),
  limit: z.number().min(0).finite(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const WRITE_TOOLS = ["create_transaction", "create_recurring_rule", "set_budget"] as const;
export type WriteTool = (typeof WRITE_TOOLS)[number];

export function isWriteTool(name: string): name is WriteTool {
  return (WRITE_TOOLS as readonly string[]).includes(name);
}

// A staged write, as it travels to the browser and back. `summary` and `fields`
// exist purely so the confirm card can describe the change in the user's own
// terms; only `tool` and `payload` are used to perform it.
const stagedTransaction = z.object({
  tool: z.literal("create_transaction"),
  payload: z.object({
    type: z.enum(["INCOME", "EXPENSE"]),
    amount: z.number().positive().finite(),
    date: isoDaySchema,
    description: z.string().min(1).max(120),
    note: z.string().max(500).nullable(),
    categoryId: z.string().nullable(),
    accountId: z.string().nullable(),
    cleared: z.boolean(),
  }),
});

const stagedRecurring = z.object({
  tool: z.literal("create_recurring_rule"),
  payload: z.object({
    type: z.enum(["INCOME", "EXPENSE"]),
    amount: z.number().positive().finite(),
    description: z.string().min(1).max(120),
    frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.number().int().min(1).max(366),
    startDate: isoDaySchema,
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
    categoryId: z.string().nullable(),
    accountId: z.string().nullable(),
  }),
});

const stagedBudget = z.object({
  tool: z.literal("set_budget"),
  payload: z.object({
    categoryId: z.string(),
    limit: z.number().min(0).finite(),
    month: z.string().regex(/^\d{4}-\d{2}$/),
  }),
});

const describedWrite = z.object({
  id: z.string().min(1).max(64),
  summary: z.string().min(1).max(200),
  fields: z.array(z.object({ label: z.string().max(40), value: z.string().max(120) })).max(10),
});

export const stagedWriteSchema = z.intersection(
  describedWrite,
  z.discriminatedUnion("tool", [stagedTransaction, stagedRecurring, stagedBudget]),
);

export type StagedWrite = z.infer<typeof stagedWriteSchema>;

/** What the model gets told when a write is staged rather than performed. */
export interface StageOutcome {
  staged: StagedWrite | null;
  /** Tool result handed back to the model to continue its turn. */
  toolResult: string;
}

let counter = 0;
function stagedId(): string {
  counter += 1;
  return `w${Date.now().toString(36)}${counter.toString(36)}`;
}

function matchByName<T extends { id: string; name: string }>(
  items: T[],
  needle: string | undefined,
): T | null {
  if (!needle) return null;
  const lower = needle.toLowerCase();
  return items.find((i) => i.name.toLowerCase().includes(lower)) ?? null;
}

function frequencyLabel(frequency: string, interval: number): string {
  const base = frequency.toLowerCase();
  return interval > 1 ? `every ${interval} ${base} cycles` : base;
}

/**
 * Validate and resolve a write tool call without performing it. Returns the
 * descriptor to show the user plus the string the model sees next.
 */
export async function stageWrite(
  name: WriteTool,
  args: Record<string, unknown>,
  userId: string,
): Promise<StageOutcome> {
  switch (name) {
    case "create_transaction": {
      const input = createTransactionArgs.parse(args);
      const [categories, accounts] = await Promise.all([getCategories(userId), getAccounts(userId)]);
      const category = matchByName(categories, input.category_name);
      const account = matchByName(accounts, input.account_name);

      const staged: StagedWrite = {
        id: stagedId(),
        tool: "create_transaction",
        summary: `${input.type === "INCOME" ? "Income" : "Expense"}: ${input.description} for ${formatUSD(input.amount)}`,
        fields: [
          { label: "Amount", value: formatUSD(input.amount) },
          { label: "Date", value: input.date },
          { label: "Category", value: category?.name ?? "Uncategorized" },
          { label: "Account", value: account?.name ?? "None" },
        ],
        payload: {
          type: input.type,
          amount: input.amount,
          date: input.date,
          description: input.description,
          note: input.note || null,
          categoryId: category?.id ?? null,
          accountId: account?.id ?? null,
          cleared: input.cleared ?? true,
        },
      };
      return { staged, toolResult: stagedResult(staged) };
    }

    case "create_recurring_rule": {
      const input = createRecurringArgs.parse(args);
      const [categories, accounts] = await Promise.all([getCategories(userId), getAccounts(userId)]);
      const category = matchByName(categories, input.category_name);
      const account = matchByName(accounts, input.account_name);
      const interval = input.interval || 1;

      const staged: StagedWrite = {
        id: stagedId(),
        tool: "create_recurring_rule",
        summary: `Recurring ${input.type === "INCOME" ? "income" : "expense"}: ${input.description} for ${formatUSD(input.amount)} ${frequencyLabel(input.frequency, interval)}`,
        fields: [
          { label: "Amount", value: formatUSD(input.amount) },
          { label: "Repeats", value: frequencyLabel(input.frequency, interval) },
          { label: "Starts", value: input.start_date },
          { label: "Category", value: category?.name ?? "Uncategorized" },
          { label: "Account", value: account?.name ?? "None" },
        ],
        payload: {
          type: input.type,
          amount: input.amount,
          description: input.description,
          frequency: input.frequency,
          interval,
          startDate: input.start_date,
          dayOfMonth: input.day_of_month ?? null,
          categoryId: category?.id ?? null,
          accountId: account?.id ?? null,
        },
      };
      return { staged, toolResult: stagedResult(staged) };
    }

    case "set_budget": {
      const input = setBudgetArgs.parse(args);
      const categories = await getCategories(userId);
      const category = matchByName(categories, input.category_name);
      if (!category) {
        // Nothing to confirm - the model picked a category the user doesn't
        // have, so send it back to try again rather than showing a broken card.
        return {
          staged: null,
          toolResult: JSON.stringify({
            success: false,
            error: `No category found matching "${input.category_name}"`,
          }),
        };
      }

      const now = new Date();
      const month =
        input.month ||
        `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

      const staged: StagedWrite = {
        id: stagedId(),
        tool: "set_budget",
        summary: `Budget for ${category.name}: ${formatUSD(input.limit)} in ${month}`,
        fields: [
          { label: "Category", value: category.name },
          { label: "Limit", value: formatUSD(input.limit) },
          { label: "Month", value: month },
        ],
        payload: { categoryId: category.id, limit: input.limit, month },
      };
      return { staged, toolResult: stagedResult(staged) };
    }
  }
}

// The model needs to know the write did not happen yet, or it will report back
// that it created something. Say so explicitly.
function stagedResult(staged: StagedWrite): string {
  return JSON.stringify({
    success: true,
    staged: true,
    message: `Prepared but NOT yet saved - the user must confirm it: ${staged.summary}`,
  });
}

/**
 * Perform a previously staged write. Every id in the descriptor is re-checked
 * against this user's own records first: the descriptor came back from the
 * browser, so it is caller-supplied input regardless of how it was produced.
 */
export async function commitWrite(staged: StagedWrite, userId: string): Promise<string> {
  const ownsCategory = async (id: string | null) => {
    if (!id) return true;
    return Boolean(await prisma.category.findFirst({ where: { id, userId }, select: { id: true } }));
  };
  const ownsAccount = async (id: string | null) => {
    if (!id) return true;
    return Boolean(await prisma.account.findFirst({ where: { id, userId }, select: { id: true } }));
  };

  switch (staged.tool) {
    case "create_transaction": {
      const p = staged.payload;
      if (!(await ownsCategory(p.categoryId)) || !(await ownsAccount(p.accountId))) {
        throw new Error("Unknown category or account.");
      }
      await prisma.transaction.create({
        data: {
          userId,
          type: p.type,
          amount: p.amount,
          date: new Date(`${p.date}T00:00:00.000Z`),
          description: p.description,
          note: p.note,
          categoryId: p.categoryId,
          accountId: p.accountId,
          cleared: p.cleared,
        },
      });
      return `Saved ${p.description} for ${formatUSD(p.amount)}.`;
    }

    case "create_recurring_rule": {
      const p = staged.payload;
      if (!(await ownsCategory(p.categoryId)) || !(await ownsAccount(p.accountId))) {
        throw new Error("Unknown category or account.");
      }
      const startDate = new Date(`${p.startDate}T00:00:00.000Z`);
      await prisma.recurringRule.create({
        data: {
          userId,
          description: p.description,
          versions: {
            create: [{
              effectiveFrom: startDate,
              type: p.type,
              amount: p.amount,
              frequency: p.frequency,
              interval: p.interval,
              startDate,
              dayOfMonth: p.dayOfMonth,
              categoryId: p.categoryId,
              accountId: p.accountId,
            }],
          },
        },
      });
      return `Saved recurring rule ${p.description}.`;
    }

    case "set_budget": {
      const p = staged.payload;
      if (!(await ownsCategory(p.categoryId))) {
        throw new Error("Unknown category.");
      }
      const monthDate = new Date(`${p.month}-01T00:00:00.000Z`);
      await prisma.budget.upsert({
        where: {
          userId_categoryId_month: { userId, categoryId: p.categoryId, month: monthDate },
        },
        create: { userId, categoryId: p.categoryId, month: monthDate, limit: p.limit },
        update: { limit: p.limit },
      });
      return `Saved budget of ${formatUSD(p.limit)} for ${p.month}.`;
    }
  }
}
