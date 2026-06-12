import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isLocalHost } from "@/lib/setup-config";
import { ensureDefaultCategories, nameToEmail } from "@/lib/user-setup";

export const dynamic = "force-dynamic";

export function localUserName() {
  return (process.env.LOCAL_USER_NAME?.trim() || "local").toLowerCase();
}

export async function GET(req: NextRequest) {
  if (process.env.AUTH_BYPASS !== "true") {
    return NextResponse.json({ error: "Auth bypass not enabled." }, { status: 403 });
  }
  if (!isLocalHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "Auto sign-in is only available locally." }, { status: 403 });
  }

  const name = localUserName();
  const email = nameToEmail(name);

  let user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name },
      select: { id: true },
    });
  }
  await ensureDefaultCategories(user.id);

  const callbackUrl = req.nextUrl.searchParams.get("callbackUrl") || "/";
  await signIn("local-login", { name, redirectTo: callbackUrl });
}
