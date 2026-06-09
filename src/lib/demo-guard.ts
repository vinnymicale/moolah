/**
 * Returns true when the app is running in demo mode.
 * Server actions call this and return early if true, so no writes reach the DB.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}
