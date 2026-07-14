import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";

export interface TagDTO {
  id: string;
  name: string;
  color: string;
  usageCount: number;
  totalAmount: number;
}

export async function getTags(userId: string): Promise<TagDTO[]> {
  const rows = await prisma.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: { transactions: { where: { deletedAt: null }, select: { amount: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    usageCount: t.transactions.length,
    totalAmount: t.transactions.reduce((sum, x) => sum + toNumber(x.amount), 0),
  }));
}
