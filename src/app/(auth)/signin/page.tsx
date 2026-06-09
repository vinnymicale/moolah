import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { getSetupStatus, isLocalHost } from "@/lib/setup-config";
import { SignInForm } from "./SignInForm";
import { SetupPanel } from "./SetupPanel";

export default async function SignInPage() {
  // When bypass is on there's no manual sign-in - hand off to auto-signin.
  if (process.env.AUTH_BYPASS === "true") redirect("/api/auth/auto-signin");

  const session = await auth();
  if (session?.user) redirect("/");

  const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true";
  // Pre-fill the first allowed email so dev login works out of the box.
  const defaultDevEmail = process.env.ALLOWED_EMAILS?.split(",")[0]?.trim() || "";

  // First-time setup panel - only when running locally and Plaid isn't configured yet.
  const host = (await headers()).get("host");
  const status = getSetupStatus();
  const showSetup = isLocalHost(host) && !status.plaidConfigured;

  return (
    <>
      <SignInForm devLoginEnabled={devLoginEnabled} defaultDevEmail={defaultDevEmail} />
      {showSetup && <SetupPanel status={status} />}
    </>
  );
}
