"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Plus, Loader2, Play, Pencil, Eye, X, ChevronUp, ChevronDown, GripVertical } from "lucide-react";
import {
  createRuleAction,
  updateRuleAction,
  deleteRuleAction,
  setRuleEnabledAction,
  reorderRulesAction,
  previewRulesAction,
  applyRulesAction,
  type RuleInput,
} from "@/actions/rules";
import { createTagAction } from "@/actions/tags";
import type { CategoryDTO, AccountDTO, RuleDTO, TagDTO } from "@/lib/queries";
import { conditionLabel, actionLabel, type RuleCondition, type RuleAction } from "@/lib/rules";
import { moveInArray, reconcileOrder } from "@/lib/collections";
import ConfirmDeleteButton from "@/components/ConfirmDeleteButton";

type Props = { rules: RuleDTO[]; categories: CategoryDTO[]; accounts: AccountDTO[]; tags: TagDTO[] };

const CONDITION_TYPES = ["descriptionContains", "amountRange", "account", "type"] as const;
const ACTION_TYPES = ["setCategory", "rewriteDescription", "markTransfer", "split", "addTag"] as const;

function blankCondition(type: RuleCondition["type"]): RuleCondition {
  switch (type) {
    case "descriptionContains":
      return { type, value: "" };
    case "amountRange":
      return { type };
    case "account":
      return { type, accountId: "" };
    case "type":
      return { type, txnType: "EXPENSE" };
  }
}

function blankAction(type: RuleAction["type"]): RuleAction {
  switch (type) {
    case "setCategory":
      return { type, categoryId: "" };
    case "rewriteDescription":
      return { type, to: "" };
    case "markTransfer":
      return { type };
    case "split":
      return { type, parts: [{ categoryId: "", ratio: 1 }, { categoryId: "", ratio: 1 }] };
    case "addTag":
      return { type, tagId: "" };
  }
}

const TYPE_LABELS: Record<string, string> = {
  descriptionContains: "Description contains",
  amountRange: "Amount range",
  account: "Account",
  type: "Income / expense",
  setCategory: "Set category",
  rewriteDescription: "Rename description",
  markTransfer: "Mark as transfer",
  split: "Split by ratio",
  addTag: "Add tag",
};

export function RulesCard({ rules, categories, accounts, tags }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, start] = useTransition();

  // Rules run top to bottom, so their order is their priority. Keep a local
  // copy so a drag or arrow click moves the row before the save comes back.
  const [order, setOrder] = useState<string[]>(() => rules.map((r) => r.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Deleted ids stay here until the server list stops sending them back. The
  // router's cache for this entry doesn't always re-render on refresh(), so the
  // row would otherwise sit there until a reload.
  const [removed, setRemoved] = useState<string[]>([]);

  const ruleIds = rules.map((r) => r.id).join();
  useEffect(() => {
    // Reconciling the local order and the deleted-id list against the server's
    // rules can't be done during render: both depend on the previous local
    // state, not just props.
    const ids = ruleIds ? ruleIds.split(",") : [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder((prev) => reconcileOrder(prev, ids));
    setRemoved((prev) => prev.filter((id) => ids.includes(id)));
  }, [ruleIds]);

  const byId = new Map(rules.map((r) => [r.id, r]));
  const ordered = order.flatMap((id) => {
    const rule = removed.includes(id) ? undefined : byId.get(id);
    return rule ? [rule] : [];
  });

  const commitOrder = (next: string[]) => {
    const previous = order;
    setOrder(next);
    start(async () => {
      setError(null);
      const res = await reorderRulesAction(next);
      if (!res.ok) {
        setOrder(previous);
        setError(res.error);
        router.refresh();
        return;
      }
      router.refresh();
    });
  };

  // Reordering is always computed against `ordered`'s ids, not raw `order`, so
  // the client can never submit an id it isn't actually rendering a row for.
  const move = (id: string, delta: -1 | 1) => {
    const ids = ordered.map((r) => r.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    commitOrder(moveInArray(ids, from, to));
  };

  const handleDrop = (targetId: string) => {
    const sourceId = dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = ordered.map((r) => r.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    commitOrder(moveInArray(ids, from, to));
  };

  const canReorder = ordered.length > 1;

  const setEnabled = (id: string, enabled: boolean) =>
    start(async () => {
      setError(null);
      const res = await setRuleEnabledAction(id, enabled);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      setError(null);
      const res = await deleteRuleAction(id);
      if (!res.ok) return setError(res.error);
      setRemoved((prev) => (prev.includes(id) ? prev : [...prev, id]));
      router.refresh();
    });

  const preview = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      const res = await previewRulesAction();
      if (!res.ok) return setError(res.error);
      const parts: string[] = [];
      if (res.wouldCategorize) parts.push(`categorize ${res.wouldCategorize}`);
      if (res.wouldRename) parts.push(`rename ${res.wouldRename}`);
      if (res.wouldMarkTransfer) parts.push(`mark ${res.wouldMarkTransfer} transfer${res.wouldMarkTransfer === 1 ? "" : "s"}`);
      if (res.wouldSplit) parts.push(`split ${res.wouldSplit}`);
      if (res.wouldTag) parts.push(`tag ${res.wouldTag}`);
      setNotice(
        parts.length === 0
          ? "No transactions in the last year would change."
          : `Would ${parts.join(", ")} (last 365 days). Nothing changed yet.`,
      );
    });

  const applyNow = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      const res = await applyRulesAction();
      if (!res.ok) return setError(res.error);
      const parts: string[] = [];
      if (res.categorized) parts.push(`categorized ${res.categorized}`);
      if (res.renamed) parts.push(`renamed ${res.renamed}`);
      if (res.transfersMarked) parts.push(`marked ${res.transfersMarked} transfer${res.transfersMarked === 1 ? "" : "s"}`);
      if (res.split) parts.push(`split ${res.split}`);
      if (res.tagged) parts.push(`tagged ${res.tagged}`);
      setNotice(parts.length === 0 ? "No transactions matched a rule." : `Done: ${parts.join(", ")}.`);
      router.refresh();
    });

  return (
    <div className="card mt-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wand2 size={18} className="text-brand" /> Rules &amp; automation
        </h2>
        <div className="flex items-center gap-2">
          {rules.length > 0 && (
            <>
              <button onClick={preview} disabled={pending} className="btn-ghost h-8 text-xs" title="Dry run — see what would change without writing anything">
                {pending ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                Preview
              </button>
              <button onClick={applyNow} disabled={pending} className="btn-ghost h-8 text-xs" title="Run all enabled rules over the last year of transactions">
                {pending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Apply to existing
              </button>
            </>
          )}
          {editing !== "new" && (
            <button onClick={() => setEditing("new")} disabled={pending} className="btn-primary h-8 text-xs">
              <Plus size={14} /> New rule
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        <p className="mb-3 text-xs text-muted">
          When every condition of a rule holds, its actions run automatically on bank sync, CSV import, and
          via &quot;Apply to existing&quot;. Rules run top to bottom and never overwrite a category you set by hand.
          Drag a rule or use the arrows to change which one takes priority.
        </p>

        {error && <p className="mb-2 text-sm text-expense">{error}</p>}
        {notice && <p className="mb-2 text-sm text-income">{notice}</p>}

        {editing === "new" && (
          <RuleEditor
            categories={categories}
            accounts={accounts}
            tags={tags}
            onCancel={() => setEditing(null)}
            onError={setError}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}

        {rules.length === 0 && editing !== "new" ? (
          <p className="py-2 text-center text-sm text-muted">No rules yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ordered.map((rule, index) =>
              editing === rule.id ? (
                <li key={rule.id} className="py-3">
                  <RuleEditor
                    rule={rule}
                    categories={categories}
                    accounts={accounts}
                    tags={tags}
                    onCancel={() => setEditing(null)}
                    onError={setError}
                    onSaved={() => {
                      setEditing(null);
                      router.refresh();
                    }}
                  />
                </li>
              ) : (
                <li
                  key={rule.id}
                  onDragOver={(e) => {
                    if (!canReorder || !dragId || pending) return;
                    e.preventDefault();
                    const over = dragId === rule.id ? null : rule.id;
                    if (overId !== over) setOverId(over);
                  }}
                  onDrop={(e) => {
                    if (!canReorder || pending) return;
                    e.preventDefault();
                    handleDrop(rule.id);
                  }}
                  className={`flex items-center gap-2 py-2.5 ${
                    overId === rule.id ? "rounded-lg ring-2 ring-brand/50" : ""
                  } ${dragId === rule.id ? "opacity-50" : ""}`}
                >
                  {canReorder && (
                    <span
                      draggable={!pending}
                      onDragStart={(e) => {
                        if (pending) return;
                        setDragId(rule.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                      title="Drag to reorder"
                      className={`shrink-0 text-muted ${
                        pending ? "cursor-not-allowed opacity-30" : "cursor-grab active:cursor-grabbing"
                      }`}
                    >
                      <GripVertical size={14} />
                    </span>
                  )}
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={pending}
                    onChange={(e) => setEnabled(rule.id, e.target.checked)}
                    title={rule.enabled ? "Enabled" : "Disabled"}
                    className="h-4 w-4 shrink-0"
                  />
                  <div className={`min-w-0 flex-1 ${rule.enabled ? "" : "opacity-50"}`}>
                    {rule.name && <div className="text-sm font-medium">{rule.name}</div>}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
                      <span>If </span>
                      {rule.conditions.map((c, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-muted/60">and </span>}
                          <code className="rounded bg-surface2 px-1 py-0.5">{conditionLabel(c, accounts)}</code>{" "}
                        </span>
                      ))}
                      {rule.actions.map((a, i) => (
                        <span key={i} className="text-default">
                          {actionLabel(a, categories, tags)}
                          {i < rule.actions.length - 1 ? "," : ""}{" "}
                        </span>
                      ))}
                    </div>
                  </div>
                  {canReorder && (
                    <>
                      <button
                        onClick={() => move(rule.id, -1)}
                        disabled={pending || index === 0}
                        className="btn-ghost h-7 w-7 p-0! text-muted hover:text-brand disabled:opacity-30"
                        title="Move up"
                        aria-label="Move rule up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => move(rule.id, 1)}
                        disabled={pending || index === ordered.length - 1}
                        className="btn-ghost h-7 w-7 p-0! text-muted hover:text-brand disabled:opacity-30"
                        title="Move down"
                        aria-label="Move rule down"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setEditing(rule.id)}
                    disabled={pending}
                    className="btn-ghost h-7 w-7 p-0! text-muted hover:text-brand"
                    title="Edit rule"
                  >
                    <Pencil size={13} />
                  </button>
                  <ConfirmDeleteButton
                    onConfirm={() => remove(rule.id)}
                    label={rule.name || "this rule"}
                    title="Delete rule"
                    disabled={pending}
                    size="sm"
                  />
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function RuleEditor({
  rule,
  categories,
  accounts,
  tags,
  onCancel,
  onSaved,
  onError,
}: {
  rule?: RuleDTO;
  categories: CategoryDTO[];
  accounts: AccountDTO[];
  tags: TagDTO[];
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [conditions, setConditions] = useState<RuleCondition[]>(
    rule?.conditions.length ? rule.conditions : [blankCondition("descriptionContains")],
  );
  const [actions, setActions] = useState<RuleAction[]>(
    rule?.actions.length ? rule.actions : [blankAction("setCategory")],
  );
  const [pending, start] = useTransition();

  const updateCondition = (i: number, c: RuleCondition) =>
    setConditions((prev) => prev.map((p, j) => (j === i ? c : p)));
  const updateAction = (i: number, a: RuleAction) =>
    setActions((prev) => prev.map((p, j) => (j === i ? a : p)));

  const save = () =>
    start(async () => {
      const input: RuleInput = {
        name: name.trim() || null,
        enabled: rule?.enabled ?? true,
        conditions,
        actions: actions as RuleInput["actions"],
      };
      const res = rule ? await updateRuleAction(rule.id, input) : await createRuleAction(input);
      if (!res.ok) return onError(res.error);
      onSaved();
    });

  return (
    <div className="rounded-lg border border-line bg-surface2/40 p-3">
      <div className="mb-3 flex items-center gap-2">
        <input
          className="input h-9 flex-1 text-sm"
          placeholder="Rule name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-xs font-medium text-muted">When all of these match</div>
        <div className="space-y-2">
          {conditions.map((c, i) => (
            <ConditionRow
              key={i}
              condition={c}
              accounts={accounts}
              onChange={(next) => updateCondition(i, next)}
              onRemove={conditions.length > 1 ? () => setConditions((p) => p.filter((_, j) => j !== i)) : undefined}
            />
          ))}
        </div>
        <button
          onClick={() => setConditions((p) => [...p, blankCondition("descriptionContains")])}
          className="btn-ghost mt-2 h-7 text-xs"
        >
          <Plus size={13} /> Add condition
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-xs font-medium text-muted">Then do</div>
        <div className="space-y-2">
          {actions.map((a, i) => (
            <ActionRow
              key={i}
              action={a}
              categories={categories}
              tags={tags}
              onChange={(next) => updateAction(i, next)}
              onRemove={actions.length > 1 ? () => setActions((p) => p.filter((_, j) => j !== i)) : undefined}
              onError={onError}
            />
          ))}
        </div>
        <button
          onClick={() => setActions((p) => [...p, blankAction("setCategory")])}
          className="btn-ghost mt-2 h-7 text-xs"
        >
          <Plus size={13} /> Add action
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={pending} className="btn-ghost h-9 text-sm">
          Cancel
        </button>
        <button onClick={save} disabled={pending} className="btn-primary h-9 text-sm">
          {pending && <Loader2 size={14} className="animate-spin" />}
          {rule ? "Save rule" : "Create rule"}
        </button>
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  accounts,
  onChange,
  onRemove,
}: {
  condition: RuleCondition;
  accounts: AccountDTO[];
  onChange: (c: RuleCondition) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input h-9 w-44 text-sm"
        value={condition.type}
        onChange={(e) => onChange(blankCondition(e.target.value as RuleCondition["type"]))}
      >
        {CONDITION_TYPES.map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t]}</option>
        ))}
      </select>

      {condition.type === "descriptionContains" && (
        <input
          className="input h-9 flex-1 text-sm"
          placeholder='e.g. "costco"'
          value={condition.value}
          onChange={(e) => onChange({ type: "descriptionContains", value: e.target.value })}
        />
      )}

      {condition.type === "amountRange" && (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-muted">$</span>
          <input
            className="input h-9 w-24 text-sm"
            type="number"
            min={0}
            placeholder="min"
            value={condition.min ?? ""}
            onChange={(e) =>
              onChange({ ...condition, min: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
          <span className="text-muted">to $</span>
          <input
            className="input h-9 w-24 text-sm"
            type="number"
            min={0}
            placeholder="max"
            value={condition.max ?? ""}
            onChange={(e) =>
              onChange({ ...condition, max: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </div>
      )}

      {condition.type === "account" && (
        <select
          className="input h-9 flex-1 text-sm"
          value={condition.accountId}
          onChange={(e) => onChange({ type: "account", accountId: e.target.value })}
        >
          <option value="">Select account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      )}

      {condition.type === "type" && (
        <select
          className="input h-9 w-40 text-sm"
          value={condition.txnType}
          onChange={(e) => onChange({ type: "type", txnType: e.target.value as "INCOME" | "EXPENSE" })}
        >
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
        </select>
      )}

      {onRemove && (
        <button onClick={onRemove} className="btn-ghost h-8 w-8 p-0! text-muted hover:text-expense" title="Remove condition">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function ActionRow({
  action,
  categories,
  tags,
  onChange,
  onRemove,
  onError,
}: {
  action: RuleAction;
  categories: CategoryDTO[];
  tags: TagDTO[];
  onChange: (a: RuleAction) => void;
  onRemove?: () => void;
  onError: (msg: string) => void;
}) {
  const router = useRouter();
  const [creatingTag, startCreateTag] = useTransition();
  // Tags created inline are held here so the new <option> exists in the same render
  // that selects it. Waiting for the refreshed `tags` prop leaves the controlled
  // select with a value it has no option for, and it silently snaps back to blank.
  const [createdTags, setCreatedTags] = useState<{ id: string; name: string }[]>([]);
  const tagOptions: { id: string; name: string }[] = [
    ...tags,
    ...createdTags.filter((c) => !tags.some((t) => t.id === c.id)),
  ];
  return (
    <div className="flex flex-wrap items-start gap-2">
      <select
        className="input h-9 w-44 text-sm"
        value={action.type}
        onChange={(e) => onChange(blankAction(e.target.value as RuleAction["type"]))}
      >
        {ACTION_TYPES.map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t]}</option>
        ))}
      </select>

      {action.type === "setCategory" && (
        <select
          className="input h-9 flex-1 text-sm"
          value={action.categoryId}
          onChange={(e) => onChange({ type: "setCategory", categoryId: e.target.value })}
        >
          <option value="">Select category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {action.type === "rewriteDescription" && (
        <input
          className="input h-9 flex-1 text-sm"
          placeholder="Clean payee name"
          value={action.to}
          onChange={(e) => onChange({ type: "rewriteDescription", to: e.target.value })}
        />
      )}

      {action.type === "markTransfer" && (
        <span className="flex h-9 items-center text-sm text-muted">No options</span>
      )}

      {action.type === "addTag" && (
        <select
          className="input h-9 flex-1 text-sm"
          value={action.tagId}
          disabled={creatingTag}
          onChange={(e) => {
            const value = e.target.value;
            if (value !== "__create__") {
              onChange({ type: "addTag", tagId: value });
              return;
            }
            const name = window.prompt("New tag name");
            if (!name?.trim()) return;
            startCreateTag(async () => {
              const created = await createTagAction({ name });
              if (!created.ok) return onError(created.error);
              setCreatedTags((prev) => [...prev, { id: created.id, name: created.name }]);
              onChange({ type: "addTag", tagId: created.id });
              router.refresh();
            });
          }}
        >
          <option value="">Select tag…</option>
          <option value="__create__">＋ New tag…</option>
          {tagOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      )}

      {action.type === "split" && (
        <div className="flex-1 space-y-1.5">
          {action.parts.map((part, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                className="input h-9 flex-1 text-sm"
                value={part.categoryId}
                onChange={(e) =>
                  onChange({
                    ...action,
                    parts: action.parts.map((p, j) => (j === i ? { ...p, categoryId: e.target.value } : p)),
                  })
                }
              >
                <option value="">Select category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                className="input h-9 w-20 text-sm"
                type="number"
                min={0}
                step="0.1"
                placeholder="ratio"
                value={part.ratio}
                onChange={(e) =>
                  onChange({
                    ...action,
                    parts: action.parts.map((p, j) => (j === i ? { ...p, ratio: Number(e.target.value) } : p)),
                  })
                }
              />
              {action.parts.length > 2 && (
                <button
                  onClick={() => onChange({ ...action, parts: action.parts.filter((_, j) => j !== i) })}
                  className="btn-ghost h-8 w-8 p-0! text-muted hover:text-expense"
                  title="Remove part"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => onChange({ ...action, parts: [...action.parts, { categoryId: "", ratio: 1 }] })}
            className="btn-ghost h-7 text-xs"
          >
            <Plus size={13} /> Add part
          </button>
        </div>
      )}

      {onRemove && (
        <button onClick={onRemove} className="btn-ghost h-8 w-8 p-0! text-muted hover:text-expense" title="Remove action">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
