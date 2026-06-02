"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { LogIn } from "lucide-react";

export function SignInForm({
  devLoginEnabled,
  googleEnabled,
}: {
  devLoginEnabled: boolean;
  googleEnabled: boolean;
}) {
  const [devEmail, setDevEmail] = useState("demo@example.com");
  const [loading, setLoading] = useState<string | null>(null);

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Sign in to your household finances.</p>

      {googleEnabled && (
        <button
          onClick={() => {
            setLoading("google");
            signIn("google", { callbackUrl: "/" });
          }}
          disabled={loading !== null}
          className="btn-ghost w-full py-2.5"
        >
          <GoogleGlyph />
          {loading === "google" ? "Redirecting…" : "Continue with Google"}
        </button>
      )}

      {!googleEnabled && !devLoginEnabled && (
        <p className="rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-muted">
          No sign-in method is configured. Set <code className="text-text">AUTH_GOOGLE_ID</code> and{" "}
          <code className="text-text">AUTH_GOOGLE_SECRET</code> in your environment.
        </p>
      )}

      {devLoginEnabled && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-line" />
            DEV LOGIN
            <div className="h-px flex-1 bg-line" />
          </div>
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
              {loading === "dev" ? "Signing in…" : "Dev sign in"}
            </button>
          </form>
          <p className="mt-3 text-center text-xs text-muted">
            Local development only. Use <code className="text-text">demo@example.com</code> to open the seeded household.
          </p>
        </>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.6 35.3 44 30.1 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
