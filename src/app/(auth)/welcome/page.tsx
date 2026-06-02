import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { WelcomeForm } from "./WelcomeForm";

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (session.user.householdId) redirect("/");
  const defaultName = session.user.name ? `${session.user.name.split(" ")[0]}'s Household` : "Our Household";
  return <WelcomeForm defaultName={defaultName} />;
}
