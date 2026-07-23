// Pure helpers for the transaction attachment ZIP export: filename shaping,
// dedupe, and manifest CSV construction. No Prisma or Next imports so this
// stays unit-testable in isolation.

import type { TxnType } from "@/generated/prisma/enums";

export interface ZipTxnMeta {
  id: string;
  type: TxnType;
  amount: number;
  date: string;
  description: string;
  note: string | null;
  categoryName: string;
  accountName: string;
  tags: string[];
  cleared: boolean;
}

export interface ZipAttachmentMeta {
  id: string;
  filename: string;
}

export function sanitizeComponent(s: string, maxLen: number): string {
  const cleaned = s
    .replace(/[/\\ -]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "_")
    .replace(/[:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, maxLen).replace(/_+$/g, "");
}

export function signedAmount(type: TxnType, amount: number): string {
  const signed = type === "EXPENSE" ? -amount : amount;
  return signed.toFixed(2);
}

export function buildZipFilename(txn: ZipTxnMeta, att: ZipAttachmentMeta): string {
  const desc = sanitizeComponent(txn.description, 40);
  const name = sanitizeComponent(att.filename, 60);
  const shortId = txn.id.slice(0, 6);
  return `${txn.date}_${desc}_${signedAmount(txn.type, txn.amount)}_${shortId}_${name}`;
}

export function dedupeFilenames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return `${name}-${count + 1}`;
    return `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}`;
  });
}

export const MANIFEST_HEADER = [
  "File",
  "Date",
  "Type",
  "Amount",
  "Description",
  "Category",
  "Account",
  "Tags",
  "Cleared",
  "Note",
  "TransactionId",
  "AttachmentId",
];

export function manifestRow(
  file: string,
  txn: ZipTxnMeta,
  att: ZipAttachmentMeta,
): string[] {
  return [
    file,
    txn.date,
    txn.type,
    signedAmount(txn.type, txn.amount),
    txn.description,
    txn.categoryName,
    txn.accountName,
    txn.tags.join("; "),
    txn.cleared ? "yes" : "no",
    txn.note ?? "",
    txn.id,
    att.id,
  ];
}

function csvField(s: string): string {
  let v = s;
  if (/^[=+@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\n");
}
