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
  const [showArchived, setShowArchived] = useState(false);

  // Archiving used to be a one-way door: the list hid archived accounts and the
  // only unarchive control lives inside the form you open from that list.
  const archivedCount = accounts.filter((a) => a.archived).length;
  const visible = showArchived ? accounts : accounts.filter((a) => !a.archived);
  const assets = visible.filter((a) => a.isAsset);
  const liabilities = visible.filter((a) => !a.isAsset);

  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-3">
        {archivedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>Show archived ({archivedCount})</span>
          </label>
        )}
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus size={16} /> Add account
        </button>
      </div>

      <div className="stagger grid gap-5 lg:grid-cols-2">
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
