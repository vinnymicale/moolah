import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInForm } from "./SignInForm";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true";
  return <SignInForm devLoginEnabled={devLoginEnabled} />;
}
