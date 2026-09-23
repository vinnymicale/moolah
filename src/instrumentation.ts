// Next.js calls register() once when the server process starts. We use it to
// boot the in-process backup, notification, and Plaid sync schedulers on a
// long-lived server (self-hosted Docker / `npm start` / `npm run dev`).
//
// Guarded to the Node.js runtime so it never runs in the edge runtime, and
// skipped in demo mode (no real backups, notifications, or bank connections
// there). All schedulers are idempotent, so a repeated register() won't stack
// duplicate timers.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Bypass signs every visitor in as the same local account, which makes the
  // household permission model meaningless. It's a development convenience, so
  // say so loudly in case an instance reached a network with it still on.
  if (process.env.AUTH_BYPASS === "true") {
    console.warn(
      "[moolah] AUTH_BYPASS=true - anyone who can reach this server is signed in as the local " +
        "account, with that account's permissions. Set AUTH_BYPASS=false for any shared instance.",
    );
  }

  if (process.env.DEMO_MODE === "true") return;

  const { startScheduler } = await import("@/lib/backup/scheduler");
  await startScheduler();

  const { startNotificationScheduler } = await import("@/lib/notifications/scheduler");
  await startNotificationScheduler();

  const { startPlaidSyncScheduler } = await import("@/lib/plaid-scheduler");
  await startPlaidSyncScheduler();
}
