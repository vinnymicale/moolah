import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getAccounts,
  getCategories,
  getRecurringRules,
  getTransactionsBetween,
  getNetWorth,
  getBudgetMonth,
  getSavingsGoals,
  getSpendingAnomalies,
  getTopMerchants,
} from "@/lib/queries";
import { isoDay } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Financial context tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "get_financial_summary",
    description:
      "Get a high-level summary of the household's current financial standing: net worth, account balances, and current month income/expenses.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_transactions",
    description:
      "Get transactions for a date range. Use ISO date strings (YYYY-MM-DD). Defaults to the last 30 days if not specified.",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
        end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
      },
      required: [],
    },
  },
  {
    name: "get_budget_status",
    description:
      "Get the current month's budget status: budgeted vs actual spending per category.",
    parameters: {
      type: "object",
      properties: {
        month: {
          type: "string",
          description: "Month in YYYY-MM format. Defaults to current month.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_savings_goals",
    description: "Get all active savings goals and their progress.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_spending_insights",
    description:
      "Get spending anomalies (categories where spending is unusually high this month) and top merchants by spend.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_recurring_expenses",
    description:
      "Get all active recurring rules (subscriptions, bills, paychecks, etc.).",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_transaction",
    description:
      "Create a new one-time transaction. Use this when the user wants to log income or an expense.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["INCOME", "EXPENSE"] },
        amount: { type: "number", description: "Amount in dollars (positive)" },
        date: { type: "string", description: "Date (YYYY-MM-DD)" },
        description: { type: "string", description: "Transaction description" },
        note: { type: "string", description: "Optional note" },
        category_name: {
          type: "string",
          description: "Category name to find and assign. Optional.",
        },
        account_name: {
          type: "string",
          description: "Account name to find and assign. Optional.",
        },
        cleared: {
          type: "boolean",
          description: "Whether the transaction is cleared. Defaults to true.",
        },
      },
      required: ["type", "amount", "date", "description"],
    },
  },
  {
    name: "create_recurring_rule",
    description:
      "Create a new recurring income or expense rule (e.g. monthly Netflix subscription, biweekly paycheck).",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["INCOME", "EXPENSE"] },
        amount: { type: "number", description: "Amount in dollars (positive)" },
        description: { type: "string" },
        frequency: {
          type: "string",
          enum: ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"],
        },
        interval: {
          type: "number",
          description: "Every N units of frequency. Defaults to 1.",
        },
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
        day_of_month: {
          type: "number",
          description:
            "Day of month for MONTHLY/YEARLY (1-31). Optional.",
        },
        category_name: { type: "string", description: "Category name. Optional." },
        account_name: { type: "string", description: "Account name. Optional." },
      },
      required: ["type", "amount", "description", "frequency", "start_date"],
    },
  },
  {
    name: "set_budget",
    description: "Set a monthly budget limit for a spending category.",
    parameters: {
      type: "object",
      properties: {
        category_name: { type: "string" },
        limit: { type: "number", description: "Monthly limit in dollars" },
        month: {
          type: "string",
          description: "Month (YYYY-MM). Defaults to current month.",
        },
      },
      required: ["category_name", "limit"],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

// Model-supplied arguments are untrusted input - validate before any DB write.
const isoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const createTransactionArgs = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.number().positive().finite(),
  date: isoDaySchema,
  description: z.string().min(1).max(120),
  note: z.string().max(500).optional(),
  category_name: z.string().optional(),
  account_name: z.string().optional(),
  cleared: z.boolean().optional(),
});

const createRecurringArgs = z.object({
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

const setBudgetArgs = z.object({
  category_name: z.string().min(1),
  limit: z.number().min(0).finite(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  householdId: string,
): Promise<string> {
  const today = isoDay(new Date());

  try {
    switch (name) {
      case "get_financial_summary": {
        const [netWorth, accounts] = await Promise.all([
          getNetWorth(householdId),
          getAccounts(householdId),
        ]);
        const now = new Date();
        const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
        const txns = await getTransactionsBetween(householdId, monthStart, today);
        const income = txns.filter((t) => t.type === "INCOME" && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
        const expenses = txns.filter((t) => t.type === "EXPENSE" && !t.isTransfer).reduce((s, t) => s + t.amount, 0);
        return JSON.stringify({
          net_worth: netWorth.net,
          assets: netWorth.assets,
          liabilities: netWorth.liabilities,
          accounts: accounts.map((a) => ({
            name: a.name,
            type: a.type,
            balance: a.currentBalance,
            is_asset: a.isAsset,
          })),
          current_month: {
            income,
            expenses,
            net: income - expenses,
          },
        });
      }

      case "get_transactions": {
        const end = (args.end_date as string) || today;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const start = (args.start_date as string) || isoDay(startDate);
        const [txns, categories, accounts] = await Promise.all([
          getTransactionsBetween(householdId, start, end),
          getCategories(householdId),
          getAccounts(householdId),
        ]);
        const catMap = new Map(categories.map((c) => [c.id, c.name]));
        const accMap = new Map(accounts.map((a) => [a.id, a.name]));
        return JSON.stringify(
          txns.map((t) => ({
            date: t.date,
            type: t.type,
            amount: t.amount,
            description: t.description,
            category: t.categoryId ? catMap.get(t.categoryId) : null,
            account: t.accountId ? accMap.get(t.accountId) : null,
            cleared: t.cleared,
          })),
        );
      }

      case "get_budget_status": {
        const now = new Date();
        const monthStr = (args.month as string) ||
          `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
        const lines = await getBudgetMonth(householdId, `${monthStr}-01`);
        return JSON.stringify(
          lines.map((l) => ({
            category: l.name,
            budgeted: l.limit,
            spent: l.actual,
            remaining: (l.limit ?? 0) - l.actual,
            over_budget: l.limit !== null && l.actual > l.limit,
          })),
        );
      }

      case "get_savings_goals": {
        const goals = await getSavingsGoals(householdId);
        return JSON.stringify(
          goals.map((g) => ({
            name: g.name,
            target: g.targetAmount,
            saved: g.currentAmount,
            progress_pct: g.targetAmount > 0 ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0,
            target_date: g.targetDate,
          })),
        );
      }

      case "get_spending_insights": {
        const [anomalies, merchants] = await Promise.all([
          getSpendingAnomalies(householdId, today),
          getTopMerchants(householdId, today, 10),
        ]);
        return JSON.stringify({ anomalies, top_merchants: merchants });
      }

      case "get_recurring_expenses": {
        const rules = await getRecurringRules(householdId);
        const [categories, accounts] = await Promise.all([
          getCategories(householdId),
          getAccounts(householdId),
        ]);
        const catMap = new Map(categories.map((c) => [c.id, c.name]));
        const accMap = new Map(accounts.map((a) => [a.id, a.name]));
        return JSON.stringify(
          rules.map((r) => ({
            description: r.description,
            type: r.type,
            amount: r.amount,
            frequency: r.frequency,
            interval: r.interval,
            category: r.categoryId ? catMap.get(r.categoryId) : null,
            account: r.accountId ? accMap.get(r.accountId) : null,
          })),
        );
      }

      case "create_transaction": {
        const input = createTransactionArgs.parse(args);
        const [categories, accounts] = await Promise.all([
          getCategories(householdId),
          getAccounts(householdId),
        ]);
        const category = input.category_name
          ? categories.find((c) => c.name.toLowerCase().includes(input.category_name!.toLowerCase()))
          : null;
        const account = input.account_name
          ? accounts.find((a) => a.name.toLowerCase().includes(input.account_name!.toLowerCase()))
          : null;

        await prisma.transaction.create({
          data: {
            householdId,
            type: input.type,
            amount: input.amount,
            date: new Date(`${input.date}T00:00:00.000Z`),
            description: input.description,
            note: input.note || null,
            categoryId: category?.id || null,
            accountId: account?.id || null,
            cleared: input.cleared ?? true,
          },
        });
        return JSON.stringify({
          success: true,
          message: `Created ${input.type} transaction: ${input.description} for $${input.amount}`,
        });
      }

      case "create_recurring_rule": {
        const input = createRecurringArgs.parse(args);
        const [categories, accounts] = await Promise.all([
          getCategories(householdId),
          getAccounts(householdId),
        ]);
        const category = input.category_name
          ? categories.find((c) => c.name.toLowerCase().includes(input.category_name!.toLowerCase()))
          : null;
        const account = input.account_name
          ? accounts.find((a) => a.name.toLowerCase().includes(input.account_name!.toLowerCase()))
          : null;

        await prisma.recurringRule.create({
          data: {
            householdId,
            type: input.type,
            amount: input.amount,
            description: input.description,
            frequency: input.frequency,
            interval: input.interval || 1,
            startDate: new Date(`${input.start_date}T00:00:00.000Z`),
            dayOfMonth: input.day_of_month || null,
            categoryId: category?.id || null,
            accountId: account?.id || null,
          },
        });
        return JSON.stringify({
          success: true,
          message: `Created recurring ${input.type}: ${input.description} — $${input.amount} ${input.frequency}`,
        });
      }

      case "set_budget": {
        const input = setBudgetArgs.parse(args);
        const categories = await getCategories(householdId);
        const category = categories.find((c) =>
          c.name.toLowerCase().includes(input.category_name.toLowerCase()),
        );
        if (!category) {
          return JSON.stringify({
            success: false,
            error: `No category found matching "${input.category_name}"`,
          });
        }

        const now = new Date();
        const monthStr = input.month ||
          `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
        const monthDate = new Date(`${monthStr}-01T00:00:00.000Z`);

        await prisma.budget.upsert({
          where: {
            householdId_categoryId_month: {
              householdId,
              categoryId: category.id,
              month: monthDate,
            },
          },
          create: {
            householdId,
            categoryId: category.id,
            month: monthDate,
            limit: input.limit,
          },
          update: { limit: input.limit },
        });
        return JSON.stringify({
          success: true,
          message: `Set budget for ${category.name} to $${input.limit}/month`,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Provider adapters — all return a plain string reply
// ---------------------------------------------------------------------------

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
  householdId: string,
): Promise<string> {
  const anthropicTools = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  // Convert to Anthropic message format and execute tool loop
  type AnthropicMsg = {
    role: "user" | "assistant";
    content: string | AnthropicBlock[];
  };
  type AnthropicBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string };

  const convMessages: AnthropicMsg[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let i = 0; i < 10; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        system: systemPrompt,
        tools: anthropicTools,
        messages: convMessages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as {
      stop_reason: string;
      content: AnthropicBlock[];
    };

    if (data.stop_reason === "end_turn") {
      const textBlock = data.content.find((b) => b.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      return textBlock?.text ?? "";
    }

    if (data.stop_reason === "tool_use") {
      const toolUses = data.content.filter((b) => b.type === "tool_use") as {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }[];

      convMessages.push({ role: "assistant", content: data.content });

      const toolResults: AnthropicBlock[] = await Promise.all(
        toolUses.map(async (tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: await executeTool(tu.name, tu.input, householdId),
        })),
      );
      convMessages.push({ role: "user", content: toolResults });
      continue;
    }

    // Unexpected stop reason — return whatever text we have
    const textBlock = data.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    return textBlock?.text ?? "";
  }

  return "I was unable to complete the request after several tool calls. Please try again.";
}

async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
  householdId: string,
): Promise<string> {
  const openaiTools = TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  type OpenAIToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
  type OpenAIMsg =
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; content: string; tool_calls?: OpenAIToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string };

  const convMessages: OpenAIMsg[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  for (let i = 0; i < 10; i++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: convMessages,
        tools: openaiTools,
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as {
      choices: {
        message: {
          role: string;
          content: string | null;
          tool_calls?: {
            id: string;
            function: { name: string; arguments: string };
          }[];
        };
        finish_reason: string;
      }[];
    };

    const choice = data.choices[0];
    if (!choice) throw new Error("No response from OpenAI");

    if (choice.finish_reason === "stop") {
      return choice.message.content ?? "";
    }

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      // The assistant message must be replayed with its tool_calls intact, or
      // OpenAI rejects the tool results that follow.
      convMessages.push({
        role: "assistant",
        content: choice.message.content ?? "",
        tool_calls: choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: tc.function,
        })),
      });

      const results = await Promise.all(
        choice.message.tool_calls.map(async (tc) => ({
          role: "tool" as const,
          tool_call_id: tc.id,
          content: await executeTool(
            tc.function.name,
            JSON.parse(tc.function.arguments) as Record<string, unknown>,
            householdId,
          ),
        })),
      );
      convMessages.push(...results);
      continue;
    }

    return choice.message.content ?? "";
  }

  return "I was unable to complete the request after several tool calls. Please try again.";
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
  householdId: string,
): Promise<string> {
  const geminiTools = [
    {
      functionDeclarations: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];

  type GeminiPart =
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: { content: string } } };

  type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

  const convMessages: GeminiContent[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  for (let i = 0; i < 10; i++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: convMessages,
          tools: geminiTools,
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as {
      candidates: {
        content: GeminiContent;
        finishReason: string;
      }[];
    };

    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error("No response from Gemini");

    const functionCalls = candidate.content.parts.filter(
      (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
        "functionCall" in p,
    );

    if (functionCalls.length === 0) {
      const textPart = candidate.content.parts.find((p): p is { text: string } => "text" in p);
      return textPart?.text ?? "";
    }

    // Execute tool calls
    convMessages.push(candidate.content);
    const responseParts: GeminiPart[] = await Promise.all(
      functionCalls.map(async (fc) => ({
        functionResponse: {
          name: fc.functionCall.name,
          response: { content: await executeTool(fc.functionCall.name, fc.functionCall.args, householdId) },
        },
      })),
    );
    convMessages.push({ role: "user", parts: responseParts });
  }

  return "I was unable to complete the request after several tool calls. Please try again.";
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Each request can fan out into many paid model calls - keep a per-user lid on it.
  const limit = checkRateLimit(`chat:${session.user.id}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.householdId) {
    return NextResponse.json({ error: "No household" }, { status: 403 });
  }

  const household = await prisma.household.findUnique({
    where: { id: user.householdId },
    select: { aiProvider: true, aiApiKey: true, name: true },
  });

  if (!household?.aiProvider || !household?.aiApiKey) {
    return NextResponse.json(
      { error: "AI assistant not configured. Add your API key in Settings." },
      { status: 422 },
    );
  }

  const bodySchema = z.object({
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(8000),
    })).min(1).max(50),
  });
  let body: ChatRequest;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const today = isoDay(new Date());
  const systemPrompt = `You are a helpful personal finance assistant for ${household.name}'s household finances. Today is ${today}.

You have access to tools to read and write their financial data. Use them proactively to answer questions with real numbers rather than giving generic advice.

Guidelines:
- When asked about spending, budgets, or balances, always call the relevant tool first to get current data.
- When the user asks you to add a transaction, create a recurring expense, or set a budget, use the appropriate tool to do it — then confirm what you did.
- Format money as dollar amounts (e.g. $1,234.56).
- Be concise and direct. Don't pad answers with financial disclaimers unless the question is genuinely about professional financial advice.
- If you create or modify data, tell the user exactly what you did so they can verify it.`;

  try {
    let reply: string;
    const householdId = user.householdId;
    const apiKey = decryptSecret(household.aiApiKey);

    switch (household.aiProvider) {
      case "anthropic":
        reply = await callAnthropic(apiKey, systemPrompt, body.messages, householdId);
        break;
      case "openai":
        reply = await callOpenAI(apiKey, systemPrompt, body.messages, householdId);
        break;
      case "gemini":
        reply = await callGemini(apiKey, systemPrompt, body.messages, householdId);
        break;
      default:
        return NextResponse.json({ error: "Unknown AI provider" }, { status: 422 });
    }

    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
