"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/demo-guard";
import { cronFor, isValidSchedule, type BackupSchedule } from "@/lib/backup/schedule";
import { isValidAlertUrl } from "@/lib/alerts/send";

const KINDS = ["ntfy", "webhook"];

export interface AlertConfigInput {
  enabled: boolean;
  kind: string;
  url: string;
  schedule: BackupSchedule;
  billsDays: number;
  budgetsEnabled: boolean;
}

export async function saveAlertConfigAction(input: AlertConfigInput) {
  if (isDemoMode()) return { ok: true as const };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };

  if (!KINDS.includes(input.kind)) {
    return { ok: false as const, error: "Invalid delivery method." };
  }
  if (!isValidSchedule(input.schedule)) {
    return { ok: false as const, error: "Invalid schedule." };
  }
  if (!Number.isInteger(input.billsDays) || input.billsDays < 1 || input.billsDays > 30) {
    return { ok: false as const, error: "Look-ahead must be between 1 and 30 days." };
  }
  const url = input.url.trim();
  if (input.enabled && !isValidAlertUrl(url)) {
    return { ok: false as const, error: "Enter a valid http(s) URL before enabling alerts." };
  }

  const data = {
    enabled: input.enabled,
    kind: input.kind,
    url,
    cron: cronFor(input.schedule),
    billsDays: input.billsDays,
    budgetsEnabled: input.budgetsEnabled,
  };

  await prisma.alertConfig.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  });

  // The schedule may have changed; tell the running scheduler to re-read it.
  const { rescheduleUser } = await import("@/lib/alerts/scheduler");
  await rescheduleUser(session.user.id);

  revalidatePath("/settings");
  return { ok: true as const };
}

export async function sendTestAlertAction() {
  if (isDemoMode()) return { ok: false as const, error: "Not available in demo mode." };
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Not signed in." };

  try {
    const { runAlertForUser } = await import("@/lib/alerts/run");
    await runAlertForUser(session.user.id, true);
    revalidatePath("/settings");
    return { ok: true as const };
  } catch (e) {
    revalidatePath("/settings");
    return { ok: false as const, error: e instanceof Error ? e.message : "Alert failed." };
  }
}
