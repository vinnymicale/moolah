import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isOpenSignupAllowed } from "@/lib/local-auth";
import { SignInForm } from "./SignInForm";

export default async function SignInPage() {
  if (process.env.AUTH_BYPASS === "true") redirect("/api/auth/auto-signin");

  const session = await auth();
  if (session?.user) redirect("/");

  // Sign-up is only ever offered to the first person here; everyone after them
  // gets an account from an admin.
  return <SignInForm passwordSet={!(await isOpenSignupAllowed())} />;
}
