// Shared limits + validation for transaction attachments. Used by the
// /api/attachments route handlers (authoritative) and the client UI (early
// feedback before uploading).

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TRANSACTION = 5;

export const ALLOWED_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

/** Attachment metadata sent to the client. Never includes the bytes. */
export interface AttachmentDTO {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Returns a user-facing error string, or null when the upload is acceptable.
 */
export function validateAttachmentUpload(input: {
  mimeType: string;
  size: number;
  existingCount: number;
}): string | null {
  if (!ALLOWED_ATTACHMENT_TYPES.has(input.mimeType)) {
    return "Unsupported file type. Use a JPEG, PNG, WebP, HEIC, or PDF.";
  }
  if (input.size <= 0) return "That file is empty.";
  if (input.size > MAX_ATTACHMENT_BYTES) return "File is too large (max 10MB).";
  if (input.existingCount >= MAX_ATTACHMENTS_PER_TRANSACTION) {
    return `A transaction can have at most ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments.`;
  }
  return null;
}
