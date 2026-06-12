import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SignInForm } from "./SignInForm";

export default async function SignInPage() {
  if (process.env.AUTH_BYPASS === "true") redirect("/api/auth/auto-signin");

  const session = await auth();
  if (session?.user) redirect("/");

  const anyUser = await prisma.user.findFirst({
    where: { passwordHash: { not: null } },
    select: { id: true },
  });

  return <SignInForm passwordSet={!!anyUser} />;
}
