"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { changePasswordAction } from "@/actions/account";

export function ChangePasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await changePasswordAction({ current, next });
    if (res.ok) {
      // refresh() first, so the layout re-reads the now-cleared flag rather than
      // bouncing the push straight back here from its cached result.
      router.refresh();
      router.push("/");
    } else {
      setError(res.error);
      setSaving(false);
    }
  };

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-semibold">Choose your password</h1>
      <p className="mb-6 text-sm text-muted">
        Your account was set up with a temporary password. Pick your own before you carry on - the
        admin who created it knows the old one.
      </p>

      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          className="input"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Temporary password"
          autoComplete="current-password"
          autoFocus
        />
        <input
          className="input"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
        />
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
        />
        {error && <p className="text-sm text-expense">{error}</p>}
        <button
          type="submit"
          disabled={saving || !current || !next || !confirm}
          className="btn-primary w-full py-2.5"
        >
          <KeyRound size={16} />
          {saving ? "Saving…" : "Save password"}
        </button>
      </form>
    </div>
  );
}
