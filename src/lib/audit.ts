// Append-only record of what people did in a household.
//
// Called explicitly from the mutation entry points rather than from Prisma
// middleware: middleware would also capture the Plaid sweep's bulk inserts,
// burying the handful of rows a person would actually want to read under
// thousands of machine writes.

import { prisma } from "@/lib/prisma";

export interface AuditEntry {
  householdId: string;
  /** Null when the writer was the server itself, such as the Plaid sweep. */
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  summary?: string;
}

/**
 * Record one entry. Never throws: an audit write failing must not roll back or
 * break the mutation it describes, so a failure is logged and swallowed.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: entry });
  } catch (e) {
    console.error("[audit] failed to record entry:", entry.action, e);
  }
}
