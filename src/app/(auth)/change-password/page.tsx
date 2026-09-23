// Where an account created by an admin lands until it picks its own password.
// Deliberately outside the (app) group: that layout redirects here, so rendering
// inside it would loop.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const { userId } = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mustChangePassword: true },
  });
  // Nothing to force, so this is just a stray visit - send them back to the app.
  if (!user?.mustChangePassword) redirect("/");

  return <ChangePasswordForm />;
}
