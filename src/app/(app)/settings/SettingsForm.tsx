"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Download } from "lucide-react";
import { updateHouseholdNameAction } from "@/actions/household";
import type { AccountDTO, CategoryDTO } from "@/lib/queries";

export function HouseholdNameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      await updateHouseholdNameAction(name);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="label">Household name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <button onClick={save} disabled={pending || !name} className="btn-primary">
        {saved ? <Check size={16} /> : null}
        {pending ? "Saving…" : saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}

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

export function InviteCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded-lg border border-line bg-surface2 px-3 py-2 font-mono text-lg tracking-widest">{code}</code>
      <button onClick={copy} className="btn-ghost h-10">
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
