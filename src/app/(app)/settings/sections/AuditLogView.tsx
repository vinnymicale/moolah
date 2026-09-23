// Server component: the audit log is read-only, so there is nothing to hydrate.

import { prisma } from "@/lib/prisma";

/** How many entries the settings page shows. The table itself keeps everything. */
const LIMIT = 50;

function when(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function AuditLogView({ householdId }: { householdId: string }) {
  const entries = await prisma.auditLog.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });
  if (entries.length === 0) {
    return <p className="text-sm text-muted">Nothing recorded yet.</p>;
  }

  const actorIds = [...new Set(entries.map((e) => e.actorId).filter((id): id is string => !!id))];
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const names = new Map(actors.map((a) => [a.id, a.name ?? "Unknown"]));

  return (
    <ul className="divide-y divide-line rounded-lg border border-line text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
          <span className="min-w-0">
            <span className="font-medium">{e.actorId ? names.get(e.actorId) ?? "Unknown" : "Moolah"}</span>{" "}
            <span className="text-muted">{e.action}</span>
            {e.summary && <span className="text-muted"> — {e.summary}</span>}
          </span>
          <span className="shrink-0 text-xs text-muted">{when(e.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
