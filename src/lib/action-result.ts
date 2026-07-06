import { PrismaClientKnownRequestError } from "@/generated/prisma/internal/prismaNamespace";
import { ZodError } from "zod";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * An error whose message is written for the user and safe to send to the
 * client. Anything else (Prisma errors, bugs) is logged and replaced with a
 * generic message so internals never leak.
 */
export class UserError extends Error {}

/** Next.js signals redirect()/notFound() by throwing; those must propagate. */
function isNextControlFlowError(e: unknown): boolean {
  const digest = (e as { digest?: string } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

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
    if (isNextControlFlowError(e)) throw e;
    if (e instanceof ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    }
    if (e instanceof UserError) {
      return { ok: false, error: e.message };
    }
    if (e instanceof PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "That already exists. Try editing the existing one instead." };
    }
    console.error("Action failed:", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
