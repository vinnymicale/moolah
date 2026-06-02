"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { CategoryIcon, CATEGORY_ICON_NAMES } from "@/components/CategoryIcon";
import type { CategoryDTO } from "@/lib/queries";
import {
  createCategoryAction, updateCategoryAction, deleteCategoryAction, type CategoryInput,
} from "@/actions/categories";
import type { CategoryKind } from "@/generated/prisma/enums";

const COLORS = [
  "#dc2626", "#ea580c", "#d97706", "#65a30d", "#16a34a", "#0d9488",
  "#0891b2", "#2563eb", "#4f46e5", "#7c3aed", "#9333ea", "#db2777", "#64748b",
];

export function CategoriesManager({ categories }: { categories: CategoryDTO[] }) {
  const [editing, setEditing] = useState<CategoryDTO | null>(null);
  const [adding, setAdding] = useState(false);

  const income = categories.filter((c) => c.kind === "INCOME");
  const expense = categories.filter((c) => c.kind === "EXPENSE");

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus size={16} /> Add category
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Group title="Expense categories" items={expense} onEdit={setEditing} />
        <Group title="Income categories" items={income} onEdit={setEditing} />
      </div>

      {(adding || editing) && (
        <CategoryForm category={editing} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </>
  );
}

function Group({ title, items, onEdit }: { title: string; items: CategoryDTO[]; onEdit: (c: CategoryDTO) => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3 font-semibold">{title}</div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">None yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 bg-surface px-4 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${c.color}22`, color: c.color }}>
                <CategoryIcon name={c.icon} size={16} />
              </span>
              <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
              <button onClick={() => onEdit(c)} className="btn-ghost h-7 w-7 !p-0" title="Edit">
                <Pencil size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryForm({ category, onClose }: { category: CategoryDTO | null; onClose: () => void }) {
  const editing = !!category;
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? "EXPENSE");
  const [color, setColor] = useState(category?.color ?? COLORS[0]);
  const [icon, setIcon] = useState(category?.icon ?? "tag");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const input: CategoryInput = { name, kind, color, icon };
      const res = editing ? await updateCategoryAction(category!.id, input) : await createCategoryAction(input);
      if (!res.ok) return setError(res.error);
      onClose();
    });

  const remove = () =>
    start(async () => {
      if (!category) return;
      await deleteCategoryAction(category.id);
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={editing ? "Edit category" : "Add category"}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Groceries" />
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface2 p-1">
          {(["EXPENSE", "INCOME"] as CategoryKind[]).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`btn text-sm ${kind === k ? "bg-surface shadow-sm" : "text-muted"}`}>
              {k === "EXPENSE" ? "Expense" : "Income"}
            </button>
          ))}
        </div>
        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface ${color === c ? "ring-brand" : "ring-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="label">Icon</label>
          <div className="grid max-h-40 grid-cols-7 gap-1.5 overflow-y-auto rounded-lg border border-line p-2">
            {CATEGORY_ICON_NAMES.map((n) => (
              <button
                key={n}
                onClick={() => setIcon(n)}
                className={`flex h-9 items-center justify-center rounded-lg ${icon === n ? "bg-brand text-brand-fg" : "hover:bg-surface2"}`}
                title={n}
              >
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
            <button onClick={submit} disabled={pending || !name} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
