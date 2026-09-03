import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isDemoMode } from "@/lib/demo-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { commitWrite, stagedWriteSchema } from "@/lib/chat-writes";

// POST /api/chat/confirm - commit a write the assistant staged.
//
// The descriptor arrives from the browser, so it gets the full validation
// treatment: schema parse here, ownership checks on every id in commitWrite.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ error: "This is a read-only demo. Changes are disabled." }, { status: 403 });
  }

  const limit = checkRateLimit(`chat-confirm:${session.user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  let staged;
  try {
    staged = z.object({ staged: stagedWriteSchema }).parse(await request.json()).staged;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const message = await commitWrite(staged, session.user.id);
    return NextResponse.json({ message });
  } catch (err) {
    console.error("[chat/confirm] commit failed:", err);
    return NextResponse.json({ error: "Couldn't save that change." }, { status: 500 });
  }
}
