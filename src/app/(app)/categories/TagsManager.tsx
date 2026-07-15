"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useConfirmAction } from "@/lib/useConfirmAction";
import { Modal } from "@/components/Modal";
import { COLOR_PALETTE } from "@/lib/colors";
import { formatUSD } from "@/lib/money";
import type { TagDTO } from "@/lib/queries";
import {
  createTagAction,
  renameTagAction,
  setTagColorAction,
  deleteTagAction,
  mergeTagsAction,
} from "@/actions/tags";

// Kept in sync with lib/tags.ts (DEFAULT_TAG_COLOR / MAX_TAG_NAME_LENGTH); not
// imported directly since that module pulls in Prisma for server-only helpers.
const DEFAULT_TAG_COLOR = "#64748b";
const MAX_TAG_NAME_LENGTH = 40;

export function TagsManager({ tags }: { tags: TagDTO[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TagDTO | null>(null);
  const [merging, setMerging] = useState<TagDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tags</h2>
        <button className="btn-primary inline-flex items-center gap-1 text-xs" onClick={() => setAdding(true)}>
          <Plus size={14} /> New tag
        </button>
      </div>

      {error && <p className="mb-2 text-sm text-expense">{error}</p>}

      {tags.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No tags yet. Create one here or type a new tag on any transaction.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {tags.map((t) => (
            <TagRow
              key={t.id}
              tag={t}
              canMerge={tags.length > 1}
              pending={pending}
              onEdit={() => setEditing(t)}
              onMerge={() => setMerging(t)}
              onDelete={() =>
                start(async () => {
                  setError(null);
                  const res = await deleteTagAction(t.id);
                  if (!res.ok) setError(res.error);
                })
              }
            />
          ))}
        </ul>
      )}

      {(adding || editing) && (
        <TagFormModal
          key={editing?.id ?? "new"}
          tag={editing}
          tags={tags}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      {merging && <MergeModal source={merging} tags={tags} onClose={() => setMerging(null)} />}
    </div>
  );
}

function TagRow({
  tag,
  canMerge,
  pending,
  onEdit,
  onMerge,
  onDelete,
}: {
  tag: TagDTO;
  canMerge: boolean;
  pending: boolean;
  onEdit: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const confirmDelete = useConfirmAction(onDelete);

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{tag.name}</p>
        <p className="text-xs text-muted">
          {tag.usageCount} transaction{tag.usageCount === 1 ? "" : "s"} · {formatUSD(tag.totalAmount)}
        </p>
      </div>
      <button className="btn-ghost text-xs" onClick={onEdit}>
        Edit
      </button>
      {canMerge && (
        <button className="btn-ghost text-xs" onClick={onMerge}>
          Merge
        </button>
      )}
      <button className="btn-ghost text-xs text-expense" disabled={pending} onClick={confirmDelete.trigger}>
        <Trash2 size={13} /> {confirmDelete.armed ? "Click to confirm" : "Delete"}
      </button>
    </li>
  );
}

function TagFormModal({ tag, tags, onClose }: { tag: TagDTO | null; tags: TagDTO[]; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? DEFAULT_TAG_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const normalized = name.trim().replace(/\s+/g, " ");
  const collision = tags.find(
    (t) => t.id !== tag?.id && t.name.toLowerCase() === normalized.toLowerCase(),
  );

  const submit = () =>
    start(async () => {
      setError(null);
      if (!tag) {
        const res = await createTagAction({ name, color });
        if (!res.ok) return setError(res.error);
      } else {
        if (normalized !== tag.name) {
          const res = await renameTagAction(tag.id, name);
          if (!res.ok) return setError(res.error);
        }
        if (color !== tag.color) {
          const res = await setTagColorAction(tag.id, color);
          if (!res.ok) return setError(res.error);
        }
      }
      onClose();
    });

  const merge = () =>
    start(async () => {
      if (!tag || !collision) return;
      setError(null);
      const res = await mergeTagsAction(tag.id, collision.id);
      if (!res.ok) return setError(res.error);
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={tag ? "Edit tag" : "New tag"}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            maxLength={MAX_TAG_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use color ${c}`}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface ${color === c ? "ring-brand" : "ring-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {collision && (
          <div className="rounded-lg border border-line bg-surface2 p-3 text-sm">
            <p>A tag named &ldquo;{collision.name}&rdquo; already exists.</p>
            {tag && (
              <button type="button" className="btn-primary mt-2 text-xs" disabled={pending} onClick={merge}>
                Merge &ldquo;{tag.name}&rdquo; into &ldquo;{collision.name}&rdquo;
              </button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={pending || !normalized || !!collision} onClick={submit}>
            {tag ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MergeModal({ source, tags, onClose }: { source: TagDTO; tags: TagDTO[]; onClose: () => void }) {
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const others = tags.filter((t) => t.id !== source.id);

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await mergeTagsAction(source.id, targetId);
      if (!res.ok) return setError(res.error);
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={`Merge "${source.name}"`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Every transaction tagged &ldquo;{source.name}&rdquo; gets the target tag instead, rules are updated, and
          &ldquo;{source.name}&rdquo; is deleted.
        </p>
        <div>
          <label className="label">Merge into</label>
          <select className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Select tag…</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-expense">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={pending || !targetId} onClick={submit}>
            Merge
          </button>
        </div>
      </div>
    </Modal>
  );
}
