"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, Trash2, X } from "lucide-react";
import {
  MAX_ATTACHMENTS_PER_TRANSACTION,
  validateAttachmentUpload,
  type AttachmentDTO,
} from "@/lib/attachments";
import { downscaleImage } from "@/lib/image-downscale";
import { useConfirmAction } from "@/lib/useConfirmAction";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

export async function uploadAttachment(
  transactionId: string,
  file: File,
): Promise<{ ok: true; attachment: AttachmentDTO } | { ok: false; error: string }> {
  const prepared = await downscaleImage(file);
  const form = new FormData();
  form.set("transactionId", transactionId);
  form.set("file", prepared);
  const res = await fetch("/api/attachments", { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "Upload failed." };
  }
  return { ok: true, attachment: (await res.json()) as AttachmentDTO };
}

function prettySize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export interface AttachmentSectionProps {
  /** Null while creating: files are staged and uploaded after save. */
  transactionId: string | null;
  initial: AttachmentDTO[];
  staged: File[];
  onStagedChange: (files: File[]) => void;
}

export function AttachmentSection(props: AttachmentSectionProps) {
  const { transactionId, initial, staged, onStagedChange } = props;
  const [items, setItems] = useState<AttachmentDTO[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<AttachmentDTO | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const count = transactionId ? items.length : staged.length;
  const full = count >= MAX_ATTACHMENTS_PER_TRANSACTION;

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setError(null);
    void (async () => {
      for (const file of Array.from(files)) {
        const currentCount = transactionId ? items.length : staged.length;
        const invalid = validateAttachmentUpload({
          mimeType: file.type,
          size: file.size,
          existingCount: currentCount,
        });
        if (invalid) {
          setError(invalid);
          return;
        }
        if (!transactionId) {
          onStagedChange([...staged, file]);
          continue;
        }
        setBusy(true);
        const res = await uploadAttachment(transactionId, file);
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setItems((prev) => [...prev, res.attachment]);
      }
    })();
  };

  const remove = (att: AttachmentDTO) =>
    void (async () => {
      const res = await fetch(`/api/attachments/${att.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't delete that attachment.");
        return;
      }
      setItems((prev) => prev.filter((a) => a.id !== att.id));
    })();

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label">Attachments</label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || full}
          className="text-xs text-muted underline hover:text-text disabled:opacity-50"
        >
          {busy ? "Uploading…" : full ? `Max ${MAX_ATTACHMENTS_PER_TRANSACTION}` : "Add file"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {transactionId ? (
        items.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {items.map((att) => (
              <AttachmentChip key={att.id} att={att} onOpen={() => openAttachment(att, setLightbox)} onDelete={() => remove(att)} />
            ))}
          </ul>
        )
      ) : (
        staged.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {staged.map((file, i) => (
              <li key={`${file.name}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs">
                <Paperclip size={12} className="text-muted" />
                <span className="max-w-40 truncate">{file.name}</span>
                <span className="text-muted">{prettySize(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => onStagedChange(staged.filter((_, j) => j !== i))}
                  className="text-muted hover:text-text"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {error && <p className="mt-1 text-xs text-expense">{error}</p>}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/attachments/${lightbox.id}`}
            alt={lightbox.filename}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}

function openAttachment(att: AttachmentDTO, setLightbox: (a: AttachmentDTO | null) => void) {
  if (att.mimeType === "application/pdf") {
    window.open(`/api/attachments/${att.id}`, "_blank", "noopener");
  } else {
    setLightbox(att);
  }
}

function AttachmentChip(props: { att: AttachmentDTO; onOpen: () => void; onDelete: () => void }) {
  const { att, onOpen, onDelete } = props;
  const confirmDelete = useConfirmAction(onDelete);
  const isPdf = att.mimeType === "application/pdf";
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        title={att.filename}
        className="block overflow-hidden rounded-lg border border-line hover:border-text/30"
      >
        {isPdf ? (
          <span className="flex h-16 w-16 flex-col items-center justify-center gap-1 text-muted">
            <FileText size={20} />
            <span className="text-[10px]">PDF</span>
          </span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={`/api/attachments/${att.id}`} alt={att.filename} className="h-16 w-16 object-cover" />
        )}
      </button>
      <button
        type="button"
        aria-label={`Delete ${att.filename}`}
        onClick={confirmDelete.trigger}
        className={`absolute -right-1.5 -top-1.5 rounded-full border border-line bg-surface p-1 shadow-sm ${
          confirmDelete.armed ? "text-expense" : "text-muted opacity-0 transition-opacity group-hover:opacity-100"
        }`}
      >
        <Trash2 size={11} />
      </button>
    </li>
  );
}
