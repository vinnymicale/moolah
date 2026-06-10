"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Plus, Trash2, Loader2, Play } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { categoryColor } from "@/lib/colors";
import {
  createCategoryRuleAction, deleteCategoryRuleAction, applyCategoryRulesAction,
} from "@/actions/category-rules";
import type { CategoryDTO, CategoryRuleDTO } from "@/lib/queries";

export function CategoryRulesCard({ rules, categories }: { rules: CategoryRuleDTO[]; categories: CategoryDTO[] }) {
  const router = useRouter();
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const catById = new Map(categories.map((c) => [c.id, c]));

  const add = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      const res = await createCategoryRuleAction({ pattern, categoryId });
      if (!res.ok) return setError(res.error);
      setPattern("");
      setCategoryId("");
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      setError(null);
      const res = await deleteCategoryRuleAction(id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  const applyNow = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      const res = await applyCategoryRulesAction();
      if (!res.ok) return setError(res.error);
      setNotice(
        res.updated === 0
          ? "No uncategorized transactions matched a rule."
          : `Categorized ${res.updated} transaction${res.updated === 1 ? "" : "s"}.`,
      );
      router.refresh();
    });

  return (
    <div className="card mt-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wand2 size={18} className="text-brand" /> Auto-categorization rules
        </h2>
        {rules.length > 0 && (
          <button onClick={applyNow} disabled={pending} className="btn-ghost h-8 text-xs" title="Categorize existing uncategorized transactions using these rules">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Apply to uncategorized
          </button>
        )}
      </div>

      <div className="px-4 py-4">
        <p className="mb-3 text-xs text-muted">
          When a transaction description contains the pattern, it gets the category automatically -
          on bank sync, CSV import, and via &quot;Apply to uncategorized&quot;. Rules never overwrite a
          category you set by hand.
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <input
            className="input h-9 flex-1 text-sm"
            placeholder='Description contains… e.g. "costco"'
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && pattern.trim().length >= 2 && categoryId) add(); }}
          />
          <select className="input h-9 w-48 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Assign category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button onClick={add} disabled={pending || pattern.trim().length < 2 || !categoryId} className="btn-primary h-9 text-sm">
            <Plus size={15} /> Add rule
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-expense">{error}</p>}
        {notice && <p className="mb-2 text-sm text-income">{notice}</p>}

        {rules.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted">No rules yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((rule) => {
              const cat = catById.get(rule.categoryId);
              return (
                <li key={rule.id} className="flex items-center gap-3 py-2">
                  <code className="rounded bg-surface2 px-1.5 py-0.5 text-xs">{rule.pattern}</code>
                  <span className="text-xs text-muted">→</span>
                  <span className="flex items-center gap-1.5 text-sm">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded"
                      style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}
                    >
                      <CategoryIcon name={cat?.icon ?? "tag"} size={11} />
                    </span>
                    {cat?.name ?? "(deleted category)"}
                  </span>
                  <button
                    onClick={() => remove(rule.id)}
                    disabled={pending}
                    className="btn-ghost ml-auto h-7 w-7 !p-0 text-muted hover:text-expense"
                    title="Delete rule"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
