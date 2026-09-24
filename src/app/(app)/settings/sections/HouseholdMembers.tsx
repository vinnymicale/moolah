"use client";

import { useState, useTransition } from "react";
import { Crown, Plus, Settings2, Trash2 } from "lucide-react";
import {
  addMemberAction,
  removeMemberAction,
  setMemberRoleAction,
  transferOwnershipAction,
} from "@/actions/household";
import { PermissionEditor } from "./PermissionEditor";
import type { HouseholdRoleName } from "@/lib/capabilities";

export interface MemberRow {
  id: string;
  userId: string;
  name: string;
  role: HouseholdRoleName;
  capabilities: string[];
  deniedCapabilities: string[];
  isOwner: boolean;
}

const ROLE_HELP: Record<string, string> = {
  ADMIN: "Everything, including settings, bank credentials and members.",
  MEMBER: "Sees every page, records spending, and manages budgets and goals.",
  VIEWER: "Read-only across every page.",
};

export function HouseholdMembers({ members, viewerIsOwner }: { members: MemberRow[]; viewerIsOwner: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER" | "VIEWER">("MEMBER");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      after?.();
    });

  const add = () =>
    act(
      () => addMemberAction({ name, password, role }),
      () => {
        setName("");
        setPassword("");
        setRole("MEMBER");
        setAdding(false);
      },
    );

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {members.map((m) => (
          <li key={m.id} className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {m.name}
                  {m.isOwner && <Crown size={13} className="shrink-0 text-muted" aria-label="Owner" />}
                </p>
                <p className="text-xs text-muted">{ROLE_HELP[m.role] ?? "Owns this household."}</p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {!m.isOwner && (
                  <select
                    value={m.role}
                    disabled={pending}
                    onChange={(e) =>
                      act(() => setMemberRoleAction(m.id, e.target.value as HouseholdRoleName))
                    }
                    className="input py-1 text-xs"
                    aria-label={`Role for ${m.name}`}
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="MEMBER">Member</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                )}
                {!m.isOwner && m.role !== "ADMIN" && (
                  <button
                    onClick={() => setEditing(editing === m.id ? null : m.id)}
                    className="btn-ghost px-2"
                    title="Permissions"
                  >
                    <Settings2 size={14} />
                  </button>
                )}
                {viewerIsOwner && !m.isOwner && m.role === "ADMIN" && (
                  <button
                    onClick={() => act(() => transferOwnershipAction(m.id))}
                    disabled={pending}
                    className="btn-ghost px-2 text-xs"
                    title="Make owner"
                  >
                    Make owner
                  </button>
                )}
                {!m.isOwner && (
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${m.name}? Their account is deleted.`)) {
                        act(() => removeMemberAction(m.id));
                      }
                    }}
                    disabled={pending}
                    className="btn-ghost px-2 text-expense"
                    title="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {editing === m.id && (
              <div className="mt-3 border-t border-line pt-3">
                <PermissionEditor
                  memberId={m.id}
                  role={m.role}
                  granted={m.capabilities}
                  denied={m.deniedCapabilities}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="input w-full"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Temporary password"
            className="input w-full"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="input w-full"
            aria-label="Role"
          >
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
            <option value="ADMIN">Admin</option>
          </select>
          <p className="text-xs text-muted">
            They sign in with this name and password, and have to pick a new password first thing.
          </p>
          <div className="flex gap-2">
            <button onClick={add} disabled={pending} className="btn-primary">
              {pending ? "Adding…" : "Add member"}
            </button>
            <button onClick={() => setAdding(false)} className="btn-ghost">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Its own accessible name, not "Add member": sharing one with the submit
           button inside the form made either of them ambiguous to reach. */
        <button onClick={() => setAdding(true)} className="btn-ghost" aria-label="New member">
          <Plus size={14} /> Add member
        </button>
      )}

      {error && <p className="text-sm text-expense">{error}</p>}
    </div>
  );
}
