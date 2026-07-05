"use client";

import { useState, useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import { updatePlaidConfigAction, clearPlaidConfigAction } from "@/actions/settings";

export function PlaidConfigForm({
  currentClientId,
  hasSecret,
  currentEnv,
  envFallback,
}: {
  currentClientId: string | null;
  hasSecret: boolean;
  currentEnv: string | null;
  /** Whether the server's PLAID_* env vars provide a fallback config. */
  envFallback: boolean;
}) {
  const [clientId, setClientId] = useState(currentClientId ?? "");
  const [secret, setSecret] = useState("");
  const [env, setEnv] = useState(currentEnv ?? "sandbox");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const configured = !!currentClientId && hasSecret;

  const save = () =>
    start(async () => {
      await updatePlaidConfigAction(clientId, secret, env);
      setSecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const clear = () =>
    start(async () => {
      await clearPlaidConfigAction();
      setClientId("");
      setSecret("");
      setEnv("sandbox");
    });

  return (
    <div className="space-y-3">
      {!configured && envFallback && (
        <p className="rounded-lg border border-line bg-surface2 px-3 py-2 text-xs text-muted">
          Currently using the server-wide Plaid keys from <code className="text-text">.env</code>.
          Save your own keys below to use a separate Plaid account.
        </p>
      )}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="label">Client ID</label>
          <input
            className="input font-mono text-sm"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="w-36">
          <label className="label">Environment</label>
          <select className="input" value={env} onChange={(e) => setEnv(e.target.value)}>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">
          Secret{hasSecret && <span className="ml-2 text-xs text-income">Secret saved — enter a new one to replace it</span>}
        </label>
        <input
          className="input font-mono text-sm"
          type="password"
          placeholder="Secret matching the environment"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending || (!clientId.trim() && !secret.trim())}
          className="btn-primary"
        >
          {saved ? <Check size={16} /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
        {configured && (
          <button onClick={clear} disabled={pending} className="btn-ghost text-expense">
            <Trash2 size={14} /> Remove keys
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Keys from the <a className="text-brand hover:underline" href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noreferrer">Plaid dashboard</a>.
        The secret is encrypted in your database and never sent to the browser. Linked banks are tied
        to the keys that created them - changing to different keys stops existing connections from
        syncing until you re-link (a new, billed connection on production).
      </p>
    </div>
  );
}
