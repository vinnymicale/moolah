"use client";

import { useEffect } from "react";

/** Stores the browser's IANA timezone in a cookie so server components can
 * compute "today" in the user's local time (see lib/user-tz.ts). */
export function TimezoneSync() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const value = encodeURIComponent(tz);
    if (!document.cookie.split("; ").includes(`tz=${value}`)) {
      document.cookie = `tz=${value}; path=/; max-age=31536000; samesite=lax`;
    }
  }, []);
  return null;
}
