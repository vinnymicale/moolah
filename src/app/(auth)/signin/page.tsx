import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { getSetupStatus, isLocalHost } from "@/lib/setup-config";
import { SignInForm } from "./SignInForm";
import { SetupPanel } from "./SetupPanel";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true";
  const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  // Pre-fill an email the allow-list will accept, so dev login works out of the box.
  const defaultDevEmail = process.env.ALLOWED_EMAILS?.split(",")[0]?.trim() || "demo@example.com";

  // First-time setup panel — only when running locally, and only if there's
  // still something to configure (so it disappears once fully set up).
  const host = (await headers()).get("host");
  const status = getSetupStatus();
  const showSetup =
    isLocalHost(host) && (!status.googleConfigured || !status.plaidConfigured);
  const proto = host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https";
  const redirectUri = `${proto}://${host}/api/auth/callback/google`;

  return (
    <>
      <SignInForm devLoginEnabled={devLoginEnabled} googleEnabled={googleEnabled} defaultDevEmail={defaultDevEmail} />
      {showSetup && <SetupPanel status={status} redirectUri={redirectUri} />}
    </>
  );
}
