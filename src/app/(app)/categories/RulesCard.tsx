"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Plus, Trash2, Loader2, Play, Pencil, Eye, X } from "lucide-react";
import {
  createRuleAction,
  updateRuleAction,
  deleteRuleAction,
  setRuleEnabledAction,
  previewRulesAction,
  applyRulesAction,
  type RuleInput,
} from "@/actions/rules";
import type { CategoryDTO, AccountDTO, RuleDTO } from "@/lib/queries";
import type { RuleCondition, RuleAction } from "@/lib/rules";

type Props = { rules: RuleDTO[]; categories: CategoryDTO[]; accounts: AccountDTO[] };

const CONDITION_TYPES = ["descriptionContains", "amountRange", "account", "type"] as const;
const ACTION_TYPES = ["setCategory", "rewriteDescription", "markTransfer", "split"] as const;

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
  }
}

function conditionLabel(c: RuleCondition, accounts: AccountDTO[]): string {
  switch (c.type) {
    case "descriptionContains":
      return `description contains “${c.value}”`;
    case "amountRange": {
      if (c.min != null && c.max != null) return `amount $${c.min}–$${c.max}`;
      if (c.min != null) return `amount ≥ $${c.min}`;
      if (c.max != null) return `amount ≤ $${c.max}`;
      return "amount (any)";
    }
    case "account":
      return `account is ${accounts.find((a) => a.id === c.accountId)?.name ?? "?"}`;
    case "type":
      return c.txnType === "INCOME" ? "is income" : "is expense";
  }
}

function actionLabel(a: RuleAction, categories: CategoryDTO[]): string {
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "(deleted)";
  switch (a.type) {
    case "setCategory":
      return `→ ${catName(a.categoryId)}`;
    case "rewriteDescription":
      return `rename to “${a.to}”`;
    case "markTransfer":
      return "mark as transfer";
    case "split":
      return `split across ${a.parts.length} categories`;
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
};

export function RulesCard({ rules, categories, accounts }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, start] = useTransition();

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
        </p>

        {error && <p className="mb-2 text-sm text-expense">{error}</p>}
        {notice && <p className="mb-2 text-sm text-income">{notice}</p>}

        {editing === "new" && (
          <RuleEditor
            categories={categories}
            accounts={accounts}
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
            {rules.map((rule) =>
              editing === rule.id ? (
                <li key={rule.id} className="py-3">
                  <RuleEditor
                    rule={rule}
                    categories={categories}
                    accounts={accounts}
                    onCancel={() => setEditing(null)}
                    onError={setError}
                    onSaved={() => {
                      setEditing(null);
                      router.refresh();
                    }}
                  />
                </li>
              ) : (
                <li key={rule.id} className="flex items-center gap-3 py-2.5">
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
                          {actionLabel(a, categories)}
                          {i < rule.actions.length - 1 ? "," : ""}{" "}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setEditing(rule.id)}
                    disabled={pending}
                    className="btn-ghost h-7 w-7 p-0! text-muted hover:text-brand"
                    title="Edit rule"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => remove(rule.id)}
                    disabled={pending}
                    className="btn-ghost h-7 w-7 p-0! text-muted hover:text-expense"
                    title="Delete rule"
                  >
                    <Trash2 size={13} />
                  </button>
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
  onCancel,
  onSaved,
  onError,
}: {
  rule?: RuleDTO;
  categories: CategoryDTO[];
  accounts: AccountDTO[];
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
        actions,
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
              onChange={(next) => updateAction(i, next)}
              onRemove={actions.length > 1 ? () => setActions((p) => p.filter((_, j) => j !== i)) : undefined}
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
  onChange,
  onRemove,
}: {
  action: RuleAction;
  categories: CategoryDTO[];
  onChange: (a: RuleAction) => void;
  onRemove?: () => void;
}) {
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
