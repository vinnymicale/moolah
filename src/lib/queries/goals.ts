import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { isoDay } from "@/lib/dates";

export interface SavingsGoalDTO {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  color: string;
  icon: string;
  archived: boolean;
}

export async function getSavingsGoals(userId: string, includeArchived = false): Promise<SavingsGoalDTO[]> {
  const rows = await prisma.savingsGoal.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: toNumber(g.targetAmount),
    currentAmount: toNumber(g.currentAmount),
    targetDate: g.targetDate ? isoDay(g.targetDate) : null,
    color: g.color,
    icon: g.icon,
    archived: g.archived,
  }));
}
