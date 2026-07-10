"use client";

import type { ChannelDTO, RuleDTO } from "@/lib/queries/notifications";
import type { OptionItem, TriggerMeta } from "./NotificationCenter";

export function RulesPanel(_props: {
  rules: RuleDTO[];
  channels: ChannelDTO[];
  triggers: TriggerMeta[];
  groups: { id: string; label: string }[];
  accounts: OptionItem[];
  categories: OptionItem[];
}) {
  return <div className="card p-5 text-sm text-muted">Rules UI lands in the next task.</div>;
}
