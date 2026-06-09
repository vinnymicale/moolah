"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { AccountDTO, SnapshotDTO } from "@/lib/queries";
import { AccountGroup } from "./AccountGroup";
import { AccountForm } from "./AccountForm";
import { SnapshotForm } from "./SnapshotForm";

export function AccountsManager({ accounts, snapshots }: { accounts: AccountDTO[]; snapshots: SnapshotDTO[] }) {
  const [editing, setEditing] = useState<AccountDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [snapshotFor, setSnapshotFor] = useState<AccountDTO | null>(null);

  const assets = accounts.filter((a) => a.isAsset);
  const liabilities = accounts.filter((a) => !a.isAsset);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus size={16} /> Add account
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <AccountGroup
          title="Assets"
          accounts={assets}
          snapshots={snapshots}
          onEdit={setEditing}
          onSnapshot={setSnapshotFor}
        />
        <AccountGroup
          title="Liabilities"
          accounts={liabilities}
          snapshots={snapshots}
          onEdit={setEditing}
          onSnapshot={setSnapshotFor}
        />
      </div>

      {(adding || editing) && (
        <AccountForm
          account={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      {snapshotFor && <SnapshotForm account={snapshotFor} onClose={() => setSnapshotFor(null)} />}
    </>
  );
}
