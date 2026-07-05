// Next.js calls register() once when the server process starts. We use it to
// boot the in-process backup and alert schedulers on a long-lived server
// (self-hosted Docker / `npm start` / `npm run dev`).
//
// Guarded to the Node.js runtime so it never runs in the edge runtime, and
// skipped in demo mode (no real backups or alerts there). Both schedulers are
// idempotent, so a repeated register() won't stack duplicate timers.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DEMO_MODE === "true") return;

  const { startScheduler } = await import("@/lib/backup/scheduler");
  await startScheduler();

  const { startAlertScheduler } = await import("@/lib/alerts/scheduler");
  await startAlertScheduler();
}
