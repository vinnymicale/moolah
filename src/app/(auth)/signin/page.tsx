import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInForm } from "./SignInForm";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true";
  const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  // Pre-fill an email the allow-list will accept, so dev login works out of the box.
  const defaultDevEmail = process.env.ALLOWED_EMAILS?.split(",")[0]?.trim() || "demo@example.com";
  return (
    <SignInForm devLoginEnabled={devLoginEnabled} googleEnabled={googleEnabled} defaultDevEmail={defaultDevEmail} />
  );
}
