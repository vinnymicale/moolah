// Shown when a household member lacks the capability a page requires. Outside
// the (app) group so it can render without passing the same gate that sent
// the user here.

import Link from "next/link";

export const metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-semibold">You don&apos;t have access to that</h1>
      <p className="mb-6 text-sm text-muted">
        Your household admin controls which pages each member can open. If you need this one, ask
        them to turn it on for your account.
      </p>
      <Link href="/" className="btn-primary inline-block px-4 py-2">
        Back to dashboard
      </Link>
    </div>
  );
}
