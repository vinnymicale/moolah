"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/demo-guard";
import { encryptSecret } from "@/lib/crypto";
import { runScheduledBackupForUser, performBackup } from "@/lib/backup/run";
import { LocalDestination } from "@/lib/backup/local";
import { cronFor, isValidSchedule, type BackupSchedule } from "@/lib/backup/schedule";

const DESTINATIONS = ["local", "dropbox", "gdrive"];

// True when the credentials object carries at least one non-empty field, so a
// blank form doesn't overwrite a stored connection with an empty blob.
function hasValues(creds: Record<string, string | undefined>): boolean {
  return Object.values(creds).some((v) => typeof v === "string" && v.trim() !== "");
}

export interface BackupConfigInput {
  enabled: boolean;
  destination: string;
  schedule: BackupSchedule;
  keepCount: number;
  // Credentials only for cloud destinations; sent as a plain object and stored
  // encrypted. Omit (or pass null) to leave existing credentials untouched.
  credentials?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    folderId?: string;
    folderPath?: string;
  } | null;
}

export async function saveBackupConfigAction(input: BackupConfigInput) {
  if (isDemoMode()) return { ok: true as const };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };

  if (!DESTINATIONS.includes(input.destination)) {
    return { ok: false as const, error: "Invalid destination." };
  }
  if (!isValidSchedule(input.schedule)) {
    return { ok: false as const, error: "Invalid schedule." };
  }
  if (!Number.isInteger(input.keepCount) || input.keepCount < 1 || input.keepCount > 365) {
    return { ok: false as const, error: "Keep count must be between 1 and 365." };
  }

  const cron = cronFor(input.schedule);
  // Only overwrite credentials when a non-empty blob is supplied, so saving the
  // schedule doesn't wipe a previously connected account.
  const newCredentials =
    input.credentials && hasValues(input.credentials)
      ? encryptSecret(JSON.stringify(input.credentials))
      : undefined;

  // A cloud destination has to be connected before it can be enabled - either
  // with credentials supplied now or ones already stored from a prior save.
  if (input.destination === "gdrive" && input.enabled && !newCredentials) {
    const existing = await prisma.backupConfig.findUnique({
      where: { userId: session.user.id },
      select: { credentials: true },
    });
    if (!existing?.credentials) {
      return {
        ok: false as const,
        error: "Connect Google Drive first: add your client id/secret, refresh token, and folder id.",
      };
    }
  }

  const data = {
    enabled: input.enabled,
    destination: input.destination,
    cron,
    keepCount: input.keepCount,
    ...(newCredentials ? { credentials: newCredentials } : {}),
  };

  await prisma.backupConfig.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  });

  // The schedule may have changed; tell the running scheduler to re-read it.
  const { rescheduleUser } = await import("@/lib/backup/scheduler");
  await rescheduleUser(session.user.id);

  revalidatePath("/settings");
  return { ok: true as const };
}

export async function runBackupNowAction() {
  if (isDemoMode()) return { ok: false as const, error: "Not available in demo mode." };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };

  try {
    const result = await runScheduledBackupForUser(session.user.id);
    revalidatePath("/settings");
    return { ok: true as const, name: result.name, pruned: result.pruned.length };
  } catch (e) {
    revalidatePath("/settings");
    return { ok: false as const, error: e instanceof Error ? e.message : "Backup failed." };
  }
}

// Ad-hoc backup straight to the local folder, regardless of which destination
// the schedule is configured for. Skips the lastRun* bookkeeping on purpose:
// that status reflects the scheduled destination, and a quick local dump
// shouldn't overwrite a "gdrive failed" message the user still needs to see.
export async function runLocalBackupNowAction() {
  if (isDemoMode()) return { ok: false as const, error: "Not available in demo mode." };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };

  try {
    const config = await prisma.backupConfig.findUnique({
      where: { userId: session.user.id },
      select: { keepCount: true },
    });
    const result = await performBackup(new LocalDestination(), config?.keepCount ?? 7);
    return { ok: true as const, name: result.name, pruned: result.pruned.length };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Backup failed." };
  }
}
