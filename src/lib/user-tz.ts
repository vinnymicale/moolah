// "Today" in the user's timezone.
//
// The server runs in UTC on Vercel, so deriving the date from the server clock
// flips to tomorrow at ~7-8pm Eastern. TimezoneSync (client) stores the IANA
// zone in a cookie; these helpers read it and fall back to UTC on first visit.

import { cookies } from "next/headers";

/** YYYY-MM-DD for the current moment in the given IANA zone (UTC fallback). */
export function todayInZone(tz: string | undefined): string {
  try {
    // en-CA formats as YYYY-MM-DD directly.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Today's ISO day in the requesting user's timezone (from the tz cookie). */
export async function userTodayISO(): Promise<string> {
  const raw = (await cookies()).get("tz")?.value;
  return todayInZone(raw ? decodeURIComponent(raw) : undefined);
}
