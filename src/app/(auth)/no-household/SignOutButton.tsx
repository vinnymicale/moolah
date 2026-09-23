"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button type="button" className="btn-primary px-4 py-2" onClick={() => signOut({ callbackUrl: "/signin" })}>
      Sign out
    </button>
  );
}
