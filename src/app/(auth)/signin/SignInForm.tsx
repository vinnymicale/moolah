"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { LogIn } from "lucide-react";

export function SignInForm({
  devLoginEnabled,
  defaultDevEmail = "",
}: {
  devLoginEnabled: boolean;
  defaultDevEmail?: string;
}) {
  const [devEmail, setDevEmail] = useState(defaultDevEmail);
  const [loading, setLoading] = useState<string | null>(null);

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Sign in to your household finances.</p>

      {!devLoginEnabled && (
        <p className="rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-muted">
          No sign-in method is configured. Set <code className="text-text">AUTH_DEV_LOGIN=true</code> in your environment.
        </p>
      )}

      {devLoginEnabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setLoading("dev");
            signIn("dev-login", { email: devEmail, callbackUrl: "/" });
          }}
          className="space-y-2"
        >
          <input
            className="input"
            type="email"
            value={devEmail}
            onChange={(e) => setDevEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <button type="submit" disabled={loading !== null} className="btn-primary w-full py-2.5">
            <LogIn size={16} />
            {loading === "dev" ? "Signing in…" : "Sign in offline"}
          </button>
        </form>
      )}
    </div>
  );
}
