"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
import type { ChannelDTO, RuleDTO } from "@/lib/queries/notifications";
import { deleteRuleAction, setRuleEnabledAction, testRuleAction } from "@/actions/notifications";
import type { OptionItem, TriggerMeta } from "./NotificationCenter";
import { RuleEditor } from "./RuleEditor";
import { ChannelsPanel } from "./ChannelsPanel";

export function RulesPanel({
  rules,
  channels,
  triggers,
  groups,
  accounts,
  categories,
  readOnly = false,
}: {
  rules: RuleDTO[];
  channels: ChannelDTO[];
  triggers: TriggerMeta[];
  groups: { id: string; label: string }[];
  accounts: OptionItem[];
  categories: OptionItem[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<RuleDTO | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testedId, setTestedId] = useState<string | null>(null);

  const triggerById = new Map(triggers.map((t) => [t.id, t]));

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-warning">{error}</p>
      )}

      {readOnly && (
        <p className="rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-muted">
          This is a read-only preview. Editing rules and sending notifications are disabled in the demo.
        </p>
      )}

      {!readOnly && (
        <div className="flex justify-end">
          <button onClick={() => setEditing("new")} className="btn-primary text-sm">
            <Plus size={15} /> Add rule
          </button>
        </div>
      )}

      {rules.length === 0 && (
        <div className="card p-8 text-center text-sm text-muted">
          No rules yet. Add one to start getting notified.
        </div>
      )}

      {groups.map((group) => {
        const groupRules = rules.filter((r) => triggerById.get(r.trigger)?.group === group.id);
        if (groupRules.length === 0) return null;
        return (
          <div key={group.id}>
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/80">
              {group.label}
            </p>
            <div className="card divide-y divide-line">
              {groupRules.map((rule) => {
                const meta = triggerById.get(rule.trigger);
                const channel = channels.find((c) => c.id === rule.channelId);
                return (
                  <div key={rule.id} className="flex items-center gap-3 px-4 py-3">
                    <label className="flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={pending || readOnly}
                        onChange={(e) => act(() => setRuleEnabledAction(rule.id, e.target.checked))}
                        className="h-4 w-4 accent-current"
                        aria-label={`Enable ${rule.name}`}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-medium ${rule.enabled ? "" : "text-muted"}`}>
                        {rule.name}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {meta?.label ?? rule.trigger} · {channel ? `Discord: ${channel.name}` : "In-app only"}
                      </p>
                    </div>
                    {!readOnly && (
                      <>
                        <button
                          onClick={() => {
                            setTestedId(null);
                            act(async () => {
                              const res = await testRuleAction(rule.id);
                              if (res.ok) setTestedId(rule.id);
                              return res;
                            });
                          }}
                          disabled={pending}
                          className="btn-ghost h-8 px-2 text-xs text-muted"
                          title="Send a test notification"
                        >
                          <Send size={13} /> {testedId === rule.id ? "Sent" : "Test"}
                        </button>
                        <button
                          onClick={() => setEditing(rule)}
                          className="btn-ghost h-8 w-8 p-0!"
                          title="Edit rule"
                          aria-label={`Edit ${rule.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete rule "${rule.name}"? Its history stays in the inbox.`)) {
                              act(() => deleteRuleAction(rule.id));
                            }
                          }}
                          disabled={pending}
                          className="btn-ghost h-8 w-8 p-0! text-muted"
                          title="Delete rule"
                          aria-label={`Delete ${rule.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <ChannelsPanel channels={channels} readOnly={readOnly} />

      {editing && (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          triggers={triggers}
          groups={groups}
          channels={channels}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
