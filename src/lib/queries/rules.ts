import { prisma } from "@/lib/prisma";
import type { RuleAction, RuleCondition } from "@/lib/rules";

export interface RuleDTO {
  id: string;
  name: string | null;
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export async function getRules(userId: string): Promise<RuleDTO[]> {
  const rows = await prisma.rule.findMany({
    where: { userId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    conditions: r.conditions as unknown as RuleCondition[],
    actions: r.actions as unknown as RuleAction[],
  }));
}
