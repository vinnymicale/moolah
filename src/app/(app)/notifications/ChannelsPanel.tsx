"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { ChannelDTO } from "@/lib/queries/notifications";
import { deleteChannelAction, saveChannelAction } from "@/actions/notifications";
import ConfirmDeleteButton from "@/components/ConfirmDeleteButton";

export function ChannelsPanel({
  channels,
  readOnly = false,
}: {
  channels: ChannelDTO[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveChannelAction({ name, webhookUrl });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAdding(false);
      setName("");
      setWebhookUrl("");
      router.refresh();
    });

  const remove = (channel: ChannelDTO) =>
    startTransition(async () => {
      await deleteChannelAction(channel.id);
      router.refresh();
    });

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Channels</h3>
          <p className="text-xs text-muted">Named Discord webhooks rules can deliver to.</p>
        </div>
        {!adding && !readOnly && (
          <button onClick={() => setAdding(true)} className="btn-ghost text-xs">
            <Plus size={13} /> Add channel
          </button>
        )}
      </div>

      {channels.length === 0 && !adding && (
        <p className="text-sm text-muted">No channels yet - rules deliver in-app only.</p>
      )}

      <div className="divide-y divide-line">
        {channels.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{c.name}</p>
              <p className="truncate font-mono text-[11px] text-muted">{c.webhookUrl}</p>
            </div>
            {!readOnly && (
              <ConfirmDeleteButton
                onConfirm={() => remove(c)}
                label={c.name}
                title="Delete channel"
                disabled={pending}
              />
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-2 space-y-2 border-t border-line pt-3">
          {error && <p className="text-sm text-warning">{error}</p>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Channel name (e.g. budget-alerts)"
            className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm"
            aria-label="Channel name"
          />
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 font-mono text-sm"
            aria-label="Webhook URL"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="btn-ghost text-xs">
              Cancel
            </button>
            <button onClick={save} disabled={pending} className="btn-primary text-xs">
              {pending ? "Saving..." : "Save channel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
