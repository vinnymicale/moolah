import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isLocalHost } from "@/lib/setup-config";
import { ensureDefaultCategories } from "@/lib/user-setup";

export const dynamic = "force-dynamic";

export function localUserEmail() {
  return (process.env.LOCAL_USER_EMAIL?.trim() || "local@moolah.local").toLowerCase();
}

export async function GET(req: NextRequest) {
  if (process.env.AUTH_BYPASS !== "true") {
    return NextResponse.json({ error: "Auth bypass not enabled." }, { status: 403 });
  }
  if (!isLocalHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "Auto sign-in is only available locally." }, { status: 403 });
  }

  const email = localUserEmail();

  // Ensure the local user exists, with the default categories seeded.
  let user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0] },
      select: { id: true },
    });
  }
  await ensureDefaultCategories(user.id);

  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") || "/";
  // signIn throws NEXT_REDIRECT internally; this never returns normally.
  await signIn("dev-login", { email, redirectTo: callbackUrl });
}
