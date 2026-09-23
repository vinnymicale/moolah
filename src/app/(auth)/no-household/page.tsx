// Shown when a signed-in user has no household membership. Deliberately outside
// the (app) group: that layout redirects here, so rendering inside it would loop.

import { SignOutButton } from "./SignOutButton";

export const metadata = { title: "No household" };

export default function NoHouseholdPage() {
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-semibold">You&apos;re not in a household yet</h1>
      <p className="mb-6 text-sm text-muted">
        Moolah keeps its accounts, budgets and transactions in a shared household ledger, and your
        account hasn&apos;t been added to one. Ask the household admin to add you, then sign in again.
      </p>
      <SignOutButton />
    </div>
  );
}
