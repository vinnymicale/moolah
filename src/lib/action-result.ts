import { ZodError } from "zod";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Wraps a server-action body so expected errors (validation, ownership) become
 * a friendly `{ ok: false, error }` the client can display, rather than an
 * unhandled exception.
 */
export async function run(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}
