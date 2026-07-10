"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck } from "lucide-react";
import type { NotificationDTO } from "@/lib/queries/notifications";
import { markReadAction } from "@/actions/notifications";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
        {notifications.map((n) => {
          const unread = !n.readAt;
          const Row = readOnly ? "div" : "button";
          return (
            <Row
              key={n.id}
              onClick={readOnly ? undefined : () => unread && markRead([n.id])}
              className={`block w-full px-4 py-3 text-left transition-colors ${
                readOnly ? "" : unread ? "bg-brand/5 hover:bg-brand/10" : "hover:bg-surface2"
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
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                    <span>{n.ruleName}</span>
                    {n.deliveryStatus === "sent" && <span>· sent to Discord</span>}
                    {n.deliveryStatus === "failed" && (
                      <span className="text-warning">· delivery failed: {n.deliveryError}</span>
                    )}
                  </div>
                </div>
              </div>
            </Row>
          );
        })}
      </div>
    </div>
  );
}
