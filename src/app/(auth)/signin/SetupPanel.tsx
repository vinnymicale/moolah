"use client";

import { useState } from "react";
import { Settings, ChevronDown, Check, X, Loader2, ExternalLink, Copy } from "lucide-react";
import type { SetupStatus } from "@/lib/setup-config";

export function SetupPanel({ status, redirectUri }: { status: SetupStatus; redirectUri: string }) {
  // Open by default when there's no working way to sign in yet.
  const noSignIn = !status.googleConfigured && !status.devLoginEnabled;
  const [open, setOpen] = useState(noSignIn);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gId, setGId] = useState("");
  const [gSecret, setGSecret] = useState("");
  const [pClient, setPClient] = useState("");
  const [pSecret, setPSecret] = useState("");
  const [pEnv, setPEnv] = useState(status.plaidEnv || "sandbox");
  const [emails, setEmails] = useState(status.allowedEmails || "");
  const [disableDev, setDisableDev] = useState(false);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authGoogleId: gId,
          authGoogleSecret: gSecret,
          plaidClientId: pClient,
          plaidSecret: pSecret,
          plaidEnv: pEnv,
          allowedEmails: emails,
          disableDevLogin: disableDev,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to save.");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card mt-4 overflow-hidden p-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-surface2"
      >
        <Settings size={16} className="shrink-0 text-muted" />
        <span className="flex-1">First-time setup — Google sign-in &amp; Plaid</span>
        <StatusPill ok={status.googleConfigured} label="Google" />
        <StatusPill ok={status.plaidConfigured} label="Plaid" />
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-line px-4 py-4">
          {saved ? (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2 font-medium text-income">
                <Check size={16} /> Saved to .env.
              </p>
              <p className="text-muted">
                Restart Moolah for the changes to take effect — <strong className="text-text">close the app
                window and reopen it</strong> (or restart the server). Your new sign-in / Plaid options will
                appear then.
              </p>
            </div>
          ) : (
            <div className="space-y-5 text-sm">
              <p className="text-xs text-muted">
                Paste your keys below — blank fields keep whatever&apos;s already set. Saved to your local{" "}
                <code className="rounded bg-surface2 px-1 text-text">.env</code>; nothing leaves your machine.
              </p>

              {/* Google */}
              <section className="space-y-2">
                <h3 className="font-semibold">
                  Google sign-in
                  {status.googleConfigured && <span className="ml-1 text-xs font-normal text-income">· configured</span>}
                </h3>
                <p className="text-xs text-muted">
                  Create a <strong className="text-text">Web application</strong> OAuth client at the{" "}
                  <a className="text-brand hover:underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                    Google Cloud Console <ExternalLink size={11} className="inline" />
                  </a>{" "}
                  and add this authorized redirect URI:
                </p>
                <CopyRow text={redirectUri} />
                <input className="input" placeholder="Client ID (…apps.googleusercontent.com)" value={gId} onChange={(e) => setGId(e.target.value)} />
                <input className="input" type="password" placeholder="Client secret" value={gSecret} onChange={(e) => setGSecret(e.target.value)} />
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={disableDev} onChange={(e) => setDisableDev(e.target.checked)} />
                  Turn off the password-less dev login once Google works
                </label>
              </section>

              {/* Plaid */}
              <section className="space-y-2">
                <h3 className="font-semibold">
                  Plaid bank sync
                  {status.plaidConfigured && <span className="ml-1 text-xs font-normal text-income">· configured</span>}
                </h3>
                <p className="text-xs text-muted">
                  Keys from the{" "}
                  <a className="text-brand hover:underline" href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noreferrer">
                    Plaid dashboard <ExternalLink size={11} className="inline" />
                  </a>
                  . Sandbox = fake test data; Production = your real banks (billed per connection).
                </p>
                <div className="flex gap-2">
                  <input className="input flex-1" placeholder="Client ID" value={pClient} onChange={(e) => setPClient(e.target.value)} />
                  <select className="input w-36" value={pEnv} onChange={(e) => setPEnv(e.target.value)}>
                    <option value="sandbox">Sandbox</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                <input className="input" type="password" placeholder="Secret (matching the environment)" value={pSecret} onChange={(e) => setPSecret(e.target.value)} />
              </section>

              {/* Allow-list */}
              <section className="space-y-1">
                <h3 className="font-semibold">
                  Who can sign in <span className="text-xs font-normal text-muted">(optional)</span>
                </h3>
                <input
                  className="input"
                  placeholder="you@gmail.com, friend@gmail.com — leave blank to allow anyone"
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                />
              </section>

              {error && <p className="text-sm text-expense">{error}</p>}

              <button onClick={save} disabled={pending} className="btn-primary">
                {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save to .env
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${
        ok ? "bg-income/10 text-income" : "bg-surface2 text-muted"
      }`}
    >
      {ok ? <Check size={11} /> : <X size={11} />} {label}
    </span>
  );
}

function CopyRow({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface2 px-3 py-2">
      <code className="flex-1 truncate text-xs text-text">{text}</code>
      <button onClick={copy} type="button" className="btn-ghost h-7 shrink-0 text-xs" title="Copy">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}
