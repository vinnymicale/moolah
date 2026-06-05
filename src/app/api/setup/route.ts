import { NextRequest, NextResponse } from "next/server";
import { isLocalHost, writeEnvConfig, type SetupValues } from "@/lib/setup-config";

// Writes credentials to .env from the in-app setup screen. Localhost-only: this
// writes secrets to disk, so it must never be reachable on a deployment.
export async function POST(req: NextRequest) {
  if (!isLocalHost(req.headers.get("host"))) {
    return NextResponse.json(
      { error: "Setup is only available when running Moolah locally." },
      { status: 403 },
    );
  }

  let body: SetupValues;
  try {
    body = (await req.json()) as SetupValues;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    await writeEnvConfig(body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to write configuration.";
    console.error("Setup write failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
