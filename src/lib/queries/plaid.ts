import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";

export interface PlaidLinkedAccountDTO {
  id: string;
  plaidAccountId: string;
  financialAccountId: string | null;
  name: string;
  officialName: string | null;
  mask: string | null;
  plaidType: string;
  plaidSubtype: string | null;
  availableBalance: number | null;
  currentBalance: number | null;
}

export interface PlaidItemDTO {
  id: string;
  institutionName: string | null;
  institutionId: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  linkedAccounts: PlaidLinkedAccountDTO[];
}

export async function getPlaidItems(userId: string): Promise<PlaidItemDTO[]> {
  const items = await prisma.plaidItem.findMany({
    where: { userId },
    include: { linkedAccounts: true },
    orderBy: { createdAt: "asc" },
  });
  return items.map((item) => ({
    id: item.id,
    institutionName: item.institutionName,
    institutionId: item.institutionId,
    lastSyncedAt: item.lastSyncedAt ? item.lastSyncedAt.toISOString() : null,
    error: item.error,
    linkedAccounts: item.linkedAccounts.map((a) => ({
      id: a.id,
      plaidAccountId: a.plaidAccountId,
      financialAccountId: a.financialAccountId,
      name: a.name,
      officialName: a.officialName,
      mask: a.mask,
      plaidType: a.plaidType,
      plaidSubtype: a.plaidSubtype,
      availableBalance: toNumber(a.availableBalance),
      currentBalance: toNumber(a.currentBalance),
    })),
  }));
}
