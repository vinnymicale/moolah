"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Check, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { CategoryIcon, CATEGORY_ICON_NAMES } from "@/components/CategoryIcon";
import { EmptyState } from "@/components/ui-bits";
import { formatUSD } from "@/lib/money";
import type { SavingsGoalDTO } from "@/lib/queries";
import {
  createGoalAction, updateGoalAction, deleteGoalAction, contributeGoalAction, type GoalInput,
} from "@/actions/goals";

const COLORS = ["#16a34a", "#0d9488", "#0891b2", "#2563eb", "#4f46e5", "#7c3aed", "#9333ea", "#db2777", "#dc2626", "#d97706"];

export function GoalsManager({ goals }: { goals: SavingsGoalDTO[] }) {
  const [editing, setEditing] = useState<SavingsGoalDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [contributing, setContributing] = useState<SavingsGoalDTO | null>(null);

  const totalSaved = goals.reduce((s, g) => s + g.currentAmount, 0);
  const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {goals.length > 0 && (
            <>Saved <span className="font-semibold text-text">{formatUSD(totalSaved)}</span> of {formatUSD(totalTarget)}</>
          )}
        </p>
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus size={16} /> Add goal
        </button>
      </div>

      {goals.length === 0 ? (
        <EmptyState
          title="No savings goals yet"
          description="Create a goal like an emergency fund, a vacation, or a down payment, and track your progress toward it."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} onContribute={() => setContributing(g)} />
          ))}
        </div>
      )}

      {(adding || editing) && (
        <GoalForm goal={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
      {contributing && <ContributeModal goal={contributing} onClose={() => setContributing(null)} />}
    </>
  );
}

function GoalCard({ goal, onEdit, onContribute }: { goal: SavingsGoalDTO; onEdit: () => void; onContribute: () => void }) {
  const pct = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const complete = goal.currentAmount >= goal.targetAmount;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <button onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${goal.color}22`, color: goal.color }}>
            <CategoryIcon name={goal.icon} size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{goal.name}</p>
            <p className="text-xs text-muted">
              {complete ? "Goal reached 🎉" : `${formatUSD(remaining)} to go`}
              {goal.targetDate ? ` · by ${formatDay(goal.targetDate)}` : ""}
            </p>
          </div>
        </button>
        <button onClick={onContribute} className="btn-ghost h-8 shrink-0 text-xs" title="Add or withdraw funds">
          <Plus size={14} /> Funds
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="tabular-nums font-semibold">{formatUSD(goal.currentAmount)}</span>
        <span className="text-xs text-muted">of {formatUSD(goal.targetAmount)} · {Math.round(pct)}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface2">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: complete ? "#16a34a" : goal.color }} />
      </div>
    </div>
  );
}

function ContributeModal({ goal, onClose }: { goal: SavingsGoalDTO; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"add" | "withdraw">("add");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const n = Number(amount.replace(/[^0-9.]/g, ""));
      if (!(n > 0)) return setError("Enter an amount greater than zero.");
      const res = await contributeGoalAction(goal.id, mode === "add" ? n : -n);
      if (!res.ok) return setError(res.error);
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={goal.name} widthClass="max-w-sm">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface2 p-1">
          {(["add", "withdraw"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`btn text-sm ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}>
              {m === "add" ? "Add funds" : "Withdraw"}
            </button>
          ))}
        </div>
        <div>
          <label className="label">Amount</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input className="input pl-7" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
          </div>
          <p className="mt-1 text-xs text-muted">Currently saved: {formatUSD(goal.currentAmount)}</p>
        </div>
        {error && <p className="text-sm text-expense">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={pending || !amount} className="btn-primary">
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {mode === "add" ? "Add" : "Withdraw"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function GoalForm({ goal, onClose }: { goal: SavingsGoalDTO | null; onClose: () => void }) {
  const editing = !!goal;
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.targetAmount) : "");
  const [current, setCurrent] = useState(goal ? String(goal.currentAmount) : "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [color, setColor] = useState(goal?.color ?? COLORS[0]);
  const [icon, setIcon] = useState(goal?.icon ?? "piggy-bank");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const input: GoalInput = {
        name,
        targetAmount: target,
        currentAmount: current || 0,
        targetDate: targetDate || null,
        color,
        icon,
      };
      const res = editing ? await updateGoalAction(goal!.id, input) : await createGoalAction(input);
      if (!res.ok) return setError(res.error);
      onClose();
    });

  const remove = () =>
    start(async () => {
      if (!goal) return;
      await deleteGoalAction(goal.id);
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={editing ? "Edit goal" : "New savings goal"}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Emergency fund" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Target amount</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input className="input pl-7" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="10,000" />
            </div>
          </div>
          <div>
            <label className="label">Saved so far</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input className="input pl-7" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="0.00" />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Target date (optional)</label>
          <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>

        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface ${color === c ? "ring-brand" : "ring-transparent"}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>

        <div>
          <label className="label">Icon</label>
          <div className="grid max-h-36 grid-cols-7 gap-1.5 overflow-y-auto rounded-lg border border-line p-2">
            {CATEGORY_ICON_NAMES.map((n) => (
              <button key={n} onClick={() => setIcon(n)} className={`flex h-9 items-center justify-center rounded-lg ${icon === n ? "bg-brand text-brand-fg" : "hover:bg-surface2"}`} title={n}>
                <CategoryIcon name={n} size={16} />
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {editing ? (
            <button onClick={remove} disabled={pending} className="btn-danger">
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={submit} disabled={pending || !name || !target} className="btn-primary">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
