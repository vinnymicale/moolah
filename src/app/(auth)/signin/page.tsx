import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInForm } from "./SignInForm";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true";
  const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  return <SignInForm devLoginEnabled={devLoginEnabled} googleEnabled={googleEnabled} />;
}
