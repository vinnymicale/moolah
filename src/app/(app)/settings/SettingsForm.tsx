"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy, Download, KeyRound, Trash2 } from "lucide-react";
import {
  updateAiConfigAction,
  clearAiConfigAction,
  updatePlaidConfigAction,
  clearPlaidConfigAction,
  generateApiTokenAction,
  revokeApiTokenAction,
} from "@/actions/settings";
import type { AccountDTO, CategoryDTO } from "@/lib/queries";

export function ExportData({ accounts, categories }: { accounts: AccountDTO[]; categories: CategoryDTO[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");

  const download = () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (account) params.set("account", account);
    if (category) params.set("category", category);
    const qs = params.toString();
    window.location.href = `/api/export/transactions${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">From (optional)</label>
          <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To (optional)</label>
          <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label">Account</label>
          <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            <option value="__uncategorized__">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <button onClick={download} className="btn-primary">
        <Download size={16} /> Download CSV
      </button>
      <p className="text-xs text-muted">
        Leave the dates empty to export your entire history. The file includes every matching transaction across all time.
      </p>
    </div>
  );
}

export function BackupData() {
  const [busy, setBusy] = useState(false);

  const download = () => {
    setBusy(true);
    // Navigating to the route streams the backup file as a download.
    window.location.href = "/api/backup";
    setTimeout(() => setBusy(false), 2500);
  };

  return (
    <button onClick={download} disabled={busy} className="btn-primary">
      <Download size={16} /> {busy ? "Preparing…" : "Download backup"}
    </button>
  );
}

export function AiConfigForm({
  currentProvider,
  hasKey,
}: {
  currentProvider: string | null;
  hasKey: boolean;
}) {
  const [provider, setProvider] = useState(currentProvider ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      await updateAiConfigAction(provider, apiKey);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const clear = () =>
    start(async () => {
      await clearAiConfigAction();
      setProvider("anthropic");
      setApiKey("");
    });

  const PROVIDERS = [
    { value: "anthropic", label: "Anthropic (Claude)" },
    { value: "openai", label: "OpenAI (ChatGPT)" },
    { value: "gemini", label: "Google Gemini" },
  ];

  const keyPlaceholder =
    provider === "anthropic"
      ? "sk-ant-…"
      : provider === "openai"
      ? "sk-…"
      : "AIza…";

  return (
    <div className="space-y-3">
      <div>
        <label className="label">AI provider</label>
        <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">
          API key{hasKey && <span className="ml-2 text-xs text-income">Key saved — enter a new one to replace it</span>}
        </label>
        <input
          className="input font-mono text-sm"
          type="password"
          placeholder={keyPlaceholder}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending || (!apiKey.trim() && !currentProvider)}
          className="btn-primary"
        >
          {saved ? <Check size={16} /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
        {(currentProvider || hasKey) && (
          <button onClick={clear} disabled={pending} className="btn-ghost text-expense">
            <Trash2 size={14} /> Remove key
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Your key is stored only in your own database and never sent to the browser. It is used solely to call the AI provider on your behalf when you use the assistant.
      </p>
    </div>
  );
}

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
