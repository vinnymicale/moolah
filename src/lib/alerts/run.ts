// The shared alert-run core: build the digest, send it, record the outcome on
// the AlertConfig row. Called by both the "Send test" button and the
// scheduler, so a manual send and a scheduled send behave identically (the
// test send just doesn't skip on an empty digest).

import { prisma } from "@/lib/prisma";
import { todayInZone } from "@/lib/user-tz";
import { buildDigestForUser, formatDigest } from "./digest";
import { sendAlert, isValidAlertUrl, type AlertKind } from "./send";

export interface AlertRunResult {
  // "sent" delivered a digest; "skipped" means there was nothing to report.
  status: "sent" | "skipped";
}

/**
 * Run one alert for a user from their stored AlertConfig, recording the
 * outcome (lastRunAt/lastStatus/lastError) so the Settings UI can show it.
 * Throws on failure after recording the error.
 *
 * `force` sends even when the digest is empty (used by the test button so the
 * user can verify delivery without waiting for something to be due).
 */
export async function runAlertForUser(userId: string, force = false): Promise<AlertRunResult> {
  const config = await prisma.alertConfig.findUnique({ where: { userId } });
  if (!config) throw new Error("No alert configuration for this user.");

  try {
    if (!isValidAlertUrl(config.url)) throw new Error("Alert URL is not a valid http(s) URL.");

    // Scheduled sends fire in server-local time, so "today" comes from the
    // server clock too (there is no request cookie to read a timezone from).
    const todayISO = todayInZone(process.env.TZ);
    const digest = await buildDigestForUser(userId, todayISO, config.billsDays, config.budgetsEnabled);
    let message = formatDigest(digest);

    if (!message && !force) {
      await prisma.alertConfig.update({
        where: { userId },
        data: { lastRunAt: new Date(), lastStatus: "skipped", lastError: null },
      });
      return { status: "skipped" };
    }
    message ??= { title: "Moolah: test alert", body: "Nothing due or over budget right now. Delivery works." };

    await sendAlert(config.kind as AlertKind, config.url, message);
    await prisma.alertConfig.update({
      where: { userId },
      data: { lastRunAt: new Date(), lastStatus: "success", lastError: null },
    });
    return { status: "sent" };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "Alert failed.";
    await prisma.alertConfig.update({
      where: { userId },
      data: { lastRunAt: new Date(), lastStatus: "error", lastError: errorMessage },
    });
    throw e;
  }
}
