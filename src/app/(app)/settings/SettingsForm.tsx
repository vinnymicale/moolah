"use client";

import { useState, useTransition } from "react";
import { Check, Download, Trash2 } from "lucide-react";
import { updateAiConfigAction, clearAiConfigAction } from "@/actions/settings";
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
