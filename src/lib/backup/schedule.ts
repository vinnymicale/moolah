// Friendly backup schedules <-> cron expressions. The UI offers a small set of
// presets (daily / weekly at a chosen hour) rather than asking users to write
// cron, but we store a real cron string so the scheduler stays generic and a
// power user could set anything via the API/DB.

export interface BackupSchedule {
  // "daily" runs every day at `hour`; "weekly" runs on `weekday` at `hour`.
  frequency: "daily" | "weekly";
  // 0-23, local server time.
  hour: number;
  // 0 (Sunday) - 6 (Saturday). Ignored for daily.
  weekday?: number;
}

export function isValidSchedule(s: BackupSchedule): boolean {
  if (s.frequency !== "daily" && s.frequency !== "weekly") return false;
  if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) return false;
  if (s.frequency === "weekly") {
    if (!Number.isInteger(s.weekday) || s.weekday! < 0 || s.weekday! > 6) return false;
  }
  return true;
}

/** Build a 5-field cron expression (minute hour day month weekday) for a schedule. */
export function cronFor(s: BackupSchedule): string {
  if (s.frequency === "weekly") return `0 ${s.hour} * * ${s.weekday}`;
  return `0 ${s.hour} * * *`;
}

/**
 * Best-effort inverse of cronFor for the UI: read one of our own presets back
 * out of a stored cron string. Returns a sensible default for anything that
 * wasn't produced by cronFor (e.g. a hand-written expression).
 */
export function scheduleFromCron(cron: string): BackupSchedule {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5 && parts[0] === "0") {
    const hour = Number(parts[1]);
    const weekdayField = parts[4];
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      if (weekdayField === "*") return { frequency: "daily", hour };
      const weekday = Number(weekdayField);
      if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
        return { frequency: "weekly", hour, weekday };
      }
    }
  }
  return { frequency: "daily", hour: 3 };
}
