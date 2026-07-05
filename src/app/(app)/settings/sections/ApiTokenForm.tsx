"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { generateApiTokenAction, revokeApiTokenAction } from "@/actions/settings";

export function ApiTokenForm({
  hasToken,
  createdAt,
}: {
  hasToken: boolean;
  /** ISO timestamp the current token was generated, if any. */
  createdAt: string | null;
}) {
  // The raw token is returned exactly once, right after generation.
  const [token, setToken] = useState<string | null>(null);
  const [active, setActive] = useState(hasToken);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tokenRef = useRef<HTMLInputElement>(null);

  const generate = () =>
    start(async () => {
      setError(null);
      const res = await generateApiTokenAction();
      if (!res.ok) {
        setError(res.error ?? "Couldn't generate a token.");
        return;
      }
      setToken(res.token);
      setActive(true);
    });

  const revoke = () =>
    start(async () => {
      await revokeApiTokenAction();
      setToken(null);
      setActive(false);
    });

  const copy = async () => {
    if (!token) return;
    // navigator.clipboard is only available in secure contexts (HTTPS or
    // localhost). Self-hosted setups are often reached over plain-HTTP on a LAN
    // where it's undefined, so fall back to selecting the text for a manual copy.
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      tokenRef.current?.focus();
      tokenRef.current?.select();
      setError("Couldn't copy automatically — the token is selected, press Ctrl/⌘+C.");
    }
  };

  return (
    <div className="space-y-3">
      {active && !token && (
        <p className="rounded-lg border border-line bg-surface2 px-3 py-2 text-xs text-muted">
          A token is active{createdAt ? ` (created ${createdAt.slice(0, 10)})` : ""}. For security the
          value is shown only once. Regenerate to get a new one — this invalidates the old token.
        </p>
      )}

      {token && (
        <div className="space-y-2 rounded-lg border border-income/40 bg-income/5 p-3">
          <p className="text-xs font-medium text-income">
            Copy this token now — you won&apos;t be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <input
              ref={tokenRef}
              readOnly
              value={token}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 truncate rounded bg-surface2 px-2 py-1.5 font-mono text-xs"
            />
            <button onClick={copy} className="btn-ghost px-2" title="Copy">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={generate} disabled={pending} className="btn-primary">
          <KeyRound size={16} /> {pending ? "Working…" : active ? "Regenerate token" : "Generate token"}
        </button>
        {active && (
          <button onClick={revoke} disabled={pending} className="btn-ghost text-expense">
            <Trash2 size={14} /> Revoke
          </button>
        )}
      </div>

      {error && <p className="text-sm text-expense">{error}</p>}

      <p className="text-xs text-muted">
        Use this token to read your data from external tools (e.g. Home Assistant) with{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">Authorization: Bearer &lt;token&gt;</code>.
        Endpoints are read-only:{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">/api/v1/summary</code>,{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">/net-worth</code>,{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">/accounts</code>,{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">/budget</code>,{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">/upcoming</code>. Only the token&apos;s
        hash is stored.
      </p>
    </div>
  );
}
