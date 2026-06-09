"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { addSnapshotAction } from "@/actions/accounts";
import type { AccountDTO } from "@/lib/queries";

export function SnapshotForm({ account, onClose }: { account: AccountDTO; onClose: () => void }) {
  const [balance, setBalance] = useState(String(account.currentBalance));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await addSnapshotAction({ accountId: account.id, balance, date, note, setCurrent: true });
      if (!res.ok) {
        setError("error" in res ? (res.error as string) : "Error");
        return;
      }
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={`Update balance - ${account.name}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Records a dated balance for net-worth history and sets the current balance. Handy for retirement
          accounts, vehicles, and property.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">New balance</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input className="input pl-7" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} autoFocus />
            </div>
          </div>
          <div>
            <label className="label">As of</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quarterly statement" />
        </div>
        {error && <p className="text-sm text-expense">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
