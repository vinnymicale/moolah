"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { updateHouseholdNameAction } from "@/actions/household";

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
