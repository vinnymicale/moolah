"use client";

import { useRef, useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { Check, Copy, Download, KeyRound, Play, Trash2, Upload } from "lucide-react";
import {
  updateAiConfigAction,
  clearAiConfigAction,
  updatePlaidConfigAction,
  clearPlaidConfigAction,
  generateApiTokenAction,
  revokeApiTokenAction,
} from "@/actions/settings";
import { saveBackupConfigAction, runBackupNowAction } from "@/actions/backup";
import type { BackupSchedule } from "@/lib/backup/schedule";
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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Destinations the user can pick. Dropbox is shown disabled until its connect
// flow lands.
const DESTINATIONS = [
  { value: "local", label: "This server (local folder)", ready: true },
  { value: "gdrive", label: "Google Drive", ready: true },
  { value: "dropbox", label: "Dropbox (coming soon)", ready: false },
];

function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}

export function ScheduledBackupForm({
  config,
}: {
  config: {
    enabled: boolean;
    destination: string;
    schedule: BackupSchedule;
    keepCount: number;
    // Whether Google Drive credentials are already stored, so the form can show
    // "connected" instead of asking for them again. The secrets never reach the
    // browser.
    gdriveConnected: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    lastBackupName: string | null;
  };
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [destination, setDestination] = useState(config.destination);
  const [frequency, setFrequency] = useState(config.schedule.frequency);
  const [hour, setHour] = useState(config.schedule.hour);
  const [weekday, setWeekday] = useState(config.schedule.weekday ?? 0);
  const [keepCount, setKeepCount] = useState(config.keepCount);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Google Drive credential fields. Left blank when already connected; filling
  // them in re-saves the connection.
  const [gdClientId, setGdClientId] = useState("");
  const [gdClientSecret, setGdClientSecret] = useState("");
  const [gdRefreshToken, setGdRefreshToken] = useState("");
  const [gdFolderId, setGdFolderId] = useState("");

  // Live "Run now" result, separate from the persisted last-run status below.
  const [runResult, setRunResult] = useState<string | null>(null);
  const [running, startRun] = useTransition();

  const destReady = DESTINATIONS.find((d) => d.value === destination)?.ready ?? false;

  const save = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const schedule: BackupSchedule =
        frequency === "weekly" ? { frequency, hour, weekday } : { frequency, hour };
      const credentials =
        destination === "gdrive"
          ? {
              clientId: gdClientId.trim(),
              clientSecret: gdClientSecret.trim(),
              refreshToken: gdRefreshToken.trim(),
              folderId: gdFolderId.trim(),
            }
          : undefined;
      const res = await saveBackupConfigAction({
        enabled,
        destination,
        schedule,
        keepCount,
        credentials,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      // Don't keep secrets sitting in the form after they're stored.
      setGdClientSecret("");
      setGdRefreshToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const runNow = () =>
    startRun(async () => {
      setError(null);
      setRunResult(null);
      const res = await runBackupNowAction();
      if (!res.ok) {
        setError(res.error ?? "Backup failed.");
        return;
      }
      setRunResult(
        res.pruned > 0
          ? `Saved ${res.name} (pruned ${res.pruned} old ${res.pruned === 1 ? "copy" : "copies"}).`
          : `Saved ${res.name}.`,
      );
    });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Run automatic backups on a schedule
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Where to store backups</label>
          <select
            className="input"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            {DESTINATIONS.map((d) => (
              <option key={d.value} value={d.value} disabled={!d.ready}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Frequency</label>
          <select
            className="input"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>

        {frequency === "weekly" && (
          <div>
            <label className="label">Day of week</label>
            <select className="input" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label">Time of day</label>
          <select className="input" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Copies to keep</label>
          <input
            type="number"
            min={1}
            max={365}
            className="input"
            value={keepCount}
            onChange={(e) => setKeepCount(Number(e.target.value))}
          />
        </div>
      </div>

      {destination === "gdrive" && (
        <div className="space-y-3 rounded-lg border border-line bg-surface2/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Google Drive connection</h3>
            {config.gdriveConnected && (
              <span className="inline-flex items-center gap-1 text-xs text-income">
                <Check size={14} /> Connected
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            Create an OAuth client (Desktop app) in the{" "}
            <a
              className="text-brand hover:underline"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              Google Cloud console
            </a>
            , grant the <code className="rounded bg-surface2 px-1 py-0.5 text-text">drive.file</code>{" "}
            scope once, and paste the values below. They&apos;re encrypted in your database and never
            sent back to the browser.{" "}
            {config.gdriveConnected && "Leave blank to keep the current connection."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Client ID</label>
              <input
                className="input"
                value={gdClientId}
                placeholder={config.gdriveConnected ? "•••••• (stored)" : ""}
                onChange={(e) => setGdClientId(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Client secret</label>
              <input
                type="password"
                className="input"
                value={gdClientSecret}
                placeholder={config.gdriveConnected ? "•••••• (stored)" : ""}
                onChange={(e) => setGdClientSecret(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Refresh token</label>
              <input
                type="password"
                className="input"
                value={gdRefreshToken}
                placeholder={config.gdriveConnected ? "•••••• (stored)" : ""}
                onChange={(e) => setGdRefreshToken(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Folder ID</label>
              <input
                className="input"
                value={gdFolderId}
                placeholder={config.gdriveConnected ? "•••••• (stored)" : ""}
                onChange={(e) => setGdFolderId(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            The folder ID is the last path segment of the Drive folder&apos;s URL. Backups are written
            into that folder and retention only prunes files there.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={pending} className="btn-primary">
          {saved ? <Check size={16} /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save schedule"}
        </button>
        <button onClick={runNow} disabled={running || !destReady} className="btn-ghost">
          <Play size={14} /> {running ? "Backing up…" : "Run backup now"}
        </button>
      </div>

      {error && <p className="text-sm text-expense">{error}</p>}
      {runResult && (
        <p className="rounded-lg border border-income/40 bg-income/5 px-3 py-2 text-sm text-income">
          {runResult}
        </p>
      )}

      {config.lastRunAt && !runResult && (
        <p
          className={`text-xs ${config.lastStatus === "error" ? "text-expense" : "text-muted"}`}
        >
          Last run {new Date(config.lastRunAt).toLocaleString()} —{" "}
          {config.lastStatus === "success"
            ? `success${config.lastBackupName ? ` (${config.lastBackupName})` : ""}`
            : config.lastStatus === "error"
            ? `failed: ${config.lastError ?? "unknown error"}`
            : config.lastStatus}
          .
        </p>
      )}

      <p className="text-xs text-muted">
        Backups run on the server while it&apos;s running, so this fits a self-hosted / always-on
        setup. The local folder defaults to{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">./backups</code>; set{" "}
        <code className="rounded bg-surface2 px-1 py-0.5 text-text">BACKUP_LOCAL_DIR</code> to point
        it at a mounted volume. Each backup is a full JSON dump including your Plaid tokens — keep the
        folder private.
      </p>
    </div>
  );
}
