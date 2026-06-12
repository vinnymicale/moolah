"use client";

import { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { signIn } from "next-auth/react";

type Mode = "signin" | "signup";

export function SignInForm({ passwordSet }: { passwordSet: boolean }) {
  const [mode, setMode] = useState<Mode>(passwordSet ? "signin" : "signup");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirm("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password) return;
    if (mode === "signup" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await signIn("local-login", {
      name: name.trim(),
      password,
      confirm: mode === "signup" ? confirm : "",
      redirect: false,
      callbackUrl: "/",
    });
    if (res?.error) {
      setError(
        mode === "signin"
          ? "Incorrect name or password."
          : "Couldn't create account. A password is already set."
      );
      setLoading(false);
    } else if (res?.url) {
      window.location.href = res.url;
    }
  };

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-semibold">
        {mode === "signin" ? "Welcome back" : "Create account"}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {mode === "signin"
          ? "Sign in to your finances."
          : "Choose a name and password to protect your data."}
      </p>

      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          className="input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          autoFocus
        />
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />
        {mode === "signup" && (
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
          />
        )}
        {error && <p className="text-sm text-expense">{error}</p>}
        <button
          type="submit"
          disabled={loading || !name.trim() || !password || (mode === "signup" && !confirm)}
          className="btn-primary w-full py-2.5"
        >
          {mode === "signin" ? <LogIn size={16} /> : <UserPlus size={16} />}
          {loading ? "Signing in…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      {/* Secondary action - de-emphasised so it doesn't compete with the primary flow */}
      {passwordSet && (
        <p className="mt-4 text-center text-xs text-muted">
          {mode === "signin" ? (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="text-brand hover:underline"
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="text-brand hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
