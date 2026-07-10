"use client";

import { useState } from "react";
import type { ChannelDTO, NotificationDTO, RuleDTO } from "@/lib/queries/notifications";
import type { ParamField } from "@/lib/notifications/types";
import { InboxList } from "./InboxList";
import { RulesPanel } from "./RulesPanel";

export interface TriggerMeta {
  id: string;
  label: string;
  description: string;
  group: string;
  paramFields: ParamField[];
  variables: { name: string; description: string }[];
  defaultTemplate: { title: string; body: string };
}

export interface OptionItem {
  id: string;
  name: string;
}

export function NotificationCenter({
  notifications,
  rules,
  channels,
  triggers,
  groups,
  accounts,
  categories,
  readOnly = false,
}: {
  notifications: NotificationDTO[];
  rules: RuleDTO[];
  channels: ChannelDTO[];
  triggers: TriggerMeta[];
  groups: { id: string; label: string }[];
  accounts: OptionItem[];
  categories: OptionItem[];
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<"inbox" | "rules">("inbox");
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-line bg-surface2 p-1 text-sm font-medium">
        {(
          [
            ["inbox", unread > 0 ? `Inbox (${unread})` : "Inbox"],
            ["rules", "Rules"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
              tab === id ? "bg-brand/10 text-brand" : "text-muted hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "inbox" ? (
        <InboxList notifications={notifications} readOnly={readOnly} />
      ) : (
        <RulesPanel
          rules={rules}
          channels={channels}
          triggers={triggers}
          groups={groups}
          accounts={accounts}
          categories={categories}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
