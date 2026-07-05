import { prisma } from "@/lib/prisma";
import type { CategoryKind } from "@/generated/prisma/enums";

export interface CategoryDTO {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  parentId: string | null;
}

export async function getCategories(userId: string): Promise<CategoryDTO[]> {
  const rows = await prisma.category.findMany({
    where: { userId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color,
    icon: c.icon,
    parentId: c.parentId,
  }));
}
