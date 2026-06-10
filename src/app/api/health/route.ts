import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkEnv } from "@/lib/env";

// Liveness/readiness probe for uptime monitors and load balancers. Verifies the
// process is up, the env is sane, and the database is reachable. Unauthenticated
// by design - it exposes no data beyond up/down and the names of any
// misconfigured settings, and must be cheap to call frequently.
export const dynamic = "force-dynamic";

export async function GET() {
  const env = checkEnv();

  let db: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }

  const ok = env.ok && db === "up";
  return NextResponse.json(
    { status: ok ? "ok" : "error", db, config: env.ok ? "ok" : env.errors },
    { status: ok ? 200 : 503 },
  );
}
