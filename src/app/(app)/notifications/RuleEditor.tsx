"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { ChannelDTO, RuleDTO } from "@/lib/queries/notifications";
import type { ParamField } from "@/lib/notifications/types";
import { saveRuleAction } from "@/actions/notifications";
import type { OptionItem, TriggerMeta } from "./NotificationCenter";

export function RuleEditor({
  rule,
  triggers,
  groups,
  channels,
  accounts,
  categories,
  onClose,
}: {
  rule: RuleDTO | null;
  triggers: TriggerMeta[];
  groups: { id: string; label: string }[];
  channels: ChannelDTO[];
  accounts: OptionItem[];
  categories: OptionItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [triggerId, setTriggerId] = useState(rule?.trigger ?? triggers[0]?.id ?? "");
  const [name, setName] = useState(rule?.name ?? "");
  const [channelId, setChannelId] = useState(rule?.channelId ?? "");
  const [customMessage, setCustomMessage] = useState(!!(rule?.templateTitle || rule?.templateBody));
  const meta = triggers.find((t) => t.id === triggerId);
  const [templateTitle, setTemplateTitle] = useState(rule?.templateTitle ?? "");
  const [templateBody, setTemplateBody] = useState(rule?.templateBody ?? "");
  const [params, setParams] = useState<Record<string, string>>(() => {
    try {
      const raw = JSON.parse(rule?.params ?? "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
    } catch {
      return {};
    }
  });

  const grouped = useMemo(
    () => groups.map((g) => ({ ...g, triggers: triggers.filter((t) => t.group === g.id) })),
    [groups, triggers],
  );

  const pickTrigger = (id: string) => {
    setTriggerId(id);
    setParams({});
  };

  const optionsFor = (field: ParamField): { value: string; label: string }[] => {
    if (field.optionsFrom === "account") return accounts.map((a) => ({ value: a.id, label: a.name }));
    if (field.optionsFrom === "category") return categories.map((c) => ({ value: c.id, label: c.name }));
    return field.options ?? [];
  };

  // Digest's weekday/hour selects carry numeric values; every other select stays a string.
  const NUMERIC_SELECT_KEYS = new Set(["weekday", "hour"]);

  const buildParamsJSON = (): string => {
    if (!meta) return "{}";
    const out: Record<string, unknown> = {};
    for (const field of meta.paramFields) {
      const raw = params[field.key];
      if (raw === undefined || raw === "") continue;
      out[field.key] =
        field.kind === "number" || NUMERIC_SELECT_KEYS.has(field.key) ? Number(raw) : raw;
    }
    return JSON.stringify(out);
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveRuleAction({
        id: rule?.id,
        name: name || meta?.label || "Rule",
        trigger: triggerId,
        params: buildParamsJSON(),
        channelId: channelId || null,
        templateTitle: customMessage ? templateTitle || null : null,
        templateBody: customMessage ? templateBody || null : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });

  const insertVar = (varName: string) => {
    setTemplateBody((b) => `${b}{{${varName}}}`);
    setCustomMessage(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={rule ? "Edit rule" : "Add rule"}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{rule ? "Edit rule" : "Add rule"}</h2>
          <button onClick={onClose} className="btn-ghost h-8 w-8 p-0!" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-warning">{error}</p>
        )}

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Trigger</span>
            <select
              value={triggerId}
              onChange={(e) => pickTrigger(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
            >
              {grouped.map((g) =>
                g.triggers.length ? (
                  <optgroup key={g.id} label={g.label}>
                    {g.triggers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
            {meta && <span className="mt-1 block text-xs text-muted">{meta.description}</span>}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Rule name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={meta?.label ?? "My rule"}
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
            />
          </label>

          {meta && meta.paramFields.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {meta.paramFields.map((field) => (
                <label key={field.key} className="block text-sm">
                  <span className="mb-1 block font-medium">{field.label}</span>
                  {field.kind === "number" ? (
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      value={params[field.key] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
                    />
                  ) : field.kind === "text" ? (
                    <input
                      type="text"
                      value={params[field.key] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
                    />
                  ) : (
                    <select
                      value={params[field.key] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
                    >
                      {field.optional !== false && <option value="">{field.optionsFrom ? "All" : "Default"}</option>}
                      {optionsFor(field).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {field.help && <span className="mt-1 block text-xs text-muted">{field.help}</span>}
                </label>
              ))}
            </div>
          )}

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Deliver to</span>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
            >
              <option value="">In-app only</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  Discord: {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={customMessage}
                onChange={(e) => setCustomMessage(e.target.checked)}
                className="h-4 w-4 accent-current"
              />
              Custom message
            </label>
            {customMessage && meta && (
              <div className="mt-3 space-y-2">
                <input
                  value={templateTitle}
                  onChange={(e) => setTemplateTitle(e.target.value)}
                  placeholder={meta.defaultTemplate.title}
                  className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm"
                  aria-label="Custom title"
                />
                <textarea
                  value={templateBody}
                  onChange={(e) => setTemplateBody(e.target.value)}
                  placeholder={meta.defaultTemplate.body}
                  rows={3}
                  className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm"
                  aria-label="Custom body"
                />
                <div className="flex flex-wrap gap-1">
                  {meta.variables.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      onClick={() => insertVar(v.name)}
                      title={v.description}
                      className="rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-text"
                    >
                      {`{{${v.name}}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">
              Cancel
            </button>
            <button onClick={save} disabled={pending} className="btn-primary text-sm">
              {pending ? "Saving..." : "Save rule"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
