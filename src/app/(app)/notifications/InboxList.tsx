"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck, Trash2 } from "lucide-react";
import type { NotificationDTO } from "@/lib/queries/notifications";
import { markReadAction, deleteNotificationAction } from "@/actions/notifications";
import { useConfirmAction } from "@/lib/useConfirmAction";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function InboxRow({
  n,
  readOnly,
  pending,
  onMarkRead,
  onDelete,
}: {
  n: NotificationDTO;
  readOnly: boolean;
  pending: boolean;
  onMarkRead: (ids: string[]) => void;
  onDelete: (id: string) => void;
}) {
  const unread = !n.readAt;
  const confirmDelete = useConfirmAction(() => onDelete(n.id));

  return (
    <div
      onClick={readOnly ? undefined : () => unread && onMarkRead([n.id])}
      className={`block w-full px-4 py-3 text-left transition-colors ${
        readOnly ? "" : unread ? "cursor-pointer bg-brand/5 hover:bg-brand/10" : "cursor-pointer hover:bg-surface2"
      } ${unread && readOnly ? "bg-brand/5" : ""}`}
    >
      <div className="flex items-start gap-2">
        {unread && <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{n.title}</p>
            <span className="shrink-0 text-xs text-muted">{timeAgo(n.firedAt)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{n.body}</p>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
            <div className="flex items-center gap-2">
              <span>{n.ruleName}</span>
              {n.deliveryStatus === "sent" && <span>· sent to Discord</span>}
              {n.deliveryStatus === "failed" && (
                <span className="text-warning">· delivery failed: {n.deliveryError}</span>
              )}
            </div>
            {!readOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  confirmDelete.trigger();
                }}
                disabled={pending}
                className="btn-ghost text-xs text-expense"
              >
                <Trash2 size={13} /> {confirmDelete.armed ? "Click to confirm" : "Delete"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InboxList({
  notifications,
  readOnly = false,
}: {
  notifications: NotificationDTO[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const markRead = (ids: string[] | "all") => {
    if (readOnly) return;
    startTransition(async () => {
      await markReadAction(ids);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (readOnly) return;
    startTransition(async () => {
      await deleteNotificationAction(id);
      router.refresh();
    });
  };

  if (notifications.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-10 text-center text-muted">
        <BellOff size={22} />
        <p className="text-sm">Nothing yet. Fired rules land here.</p>
      </div>
    );
  }

  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <div className="space-y-3">
      {hasUnread && !readOnly && (
        <div className="flex justify-end">
          <button onClick={() => markRead("all")} disabled={pending} className="btn-ghost text-xs text-muted">
            <CheckCheck size={14} /> Mark all read
          </button>
        </div>
      )}
      <div className="card divide-y divide-line">
        {notifications.map((n) => (
          <InboxRow
            key={n.id}
            n={n}
            readOnly={readOnly}
            pending={pending}
            onMarkRead={markRead}
            onDelete={remove}
          />
        ))}
      </div>
    </div>
  );
}
