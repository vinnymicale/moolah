import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { TriggerDef } from "../types";

export const plaidReauth: TriggerDef = {
  id: "plaid-reauth",
  label: "Bank connection needs re-authorization",
  description: "A Plaid connection returned ITEM_LOGIN_REQUIRED and must be relinked.",
  group: "connection",
  modes: ["sweep", "event"],
  severity: "critical",
  paramsSchema: z.object({}),
  paramFields: [],
  variables: [{ name: "institution", description: "Institution name" }],
  defaultTemplate: {
    title: "{{institution}} needs re-authorization",
    body: "The connection to {{institution}} lost access. Relink it from the Accounts page.",
  },
  sampleVars: { institution: "Sample Bank" },
  async evaluate(ctx) {
    const items = await prisma.plaidItem.findMany({
      where: { userId: ctx.userId, error: { contains: "ITEM_LOGIN_REQUIRED" } },
      select: { id: true, institutionName: true },
    });
    return items.map((item) => ({
      dedupeKey: `plaid-reauth:${item.id}:${ctx.todayISO}`,
      vars: { institution: item.institutionName ?? "Bank connection" },
    }));
  },
};
