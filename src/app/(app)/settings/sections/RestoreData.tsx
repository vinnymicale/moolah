"use client";

import { useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { Upload } from "lucide-react";

export function RestoreData() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<"idle" | "importing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | null) => {
    setError(null);
    setConfirming(false);
    setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setStatus("importing");
    setError(null);
    try {
      const res = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Import failed.");
        setStatus("idle");
        return;
      }
      // The restored data carries its own account, so this session's user is
      // gone. Sign out and send them to log in with the backup's credentials.
      setStatus("done");
      setTimeout(() => signOut({ callbackUrl: "/signin" }), 1200);
    } catch {
      setError("Couldn't reach the server to import.");
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <p className="rounded-lg border border-income/40 bg-income/5 px-3 py-2 text-sm text-income">
        Backup restored. Signing you out — log back in with the account from the backup.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={status === "importing"}
          className="btn-ghost"
        >
          <Upload size={16} /> Choose backup file
        </button>
        {file && <span className="truncate text-sm text-muted">{file.name}</span>}
      </div>

      {file && !confirming && (
        <button onClick={() => setConfirming(true)} disabled={status === "importing"} className="btn-primary">
          Restore from this file
        </button>
      )}

      {confirming && (
        <div className="space-y-2 rounded-lg border border-expense/40 bg-expense/5 p-3">
          <p className="text-sm text-expense">
            This replaces <strong>all</strong> data in this instance with the contents of the file,
            including its login and Plaid keys. The current account and its data will be wiped. This
            can&apos;t be undone.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={run} disabled={status === "importing"} className="btn-primary">
              {status === "importing" ? "Restoring…" : "Yes, replace everything"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={status === "importing"}
              className="btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-expense">{error}</p>}
    </div>
  );
}
