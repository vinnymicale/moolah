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

/**
 * Identify a file from its leading bytes. The browser-supplied `file.type` is
 * just a claim - a caller posting the form directly can put any string there -
 * so the stored mimeType is derived from the content instead. Returns null when
 * the bytes don't match a format we accept.
 *
 * HEIC/HEIF are ISO base-media containers: bytes 4-8 are "ftyp" and the brand
 * that follows says which flavour.
 */
export function sniffAttachmentType(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) =>
    sig.length <= bytes.length && sig.every((b, i) => bytes[i] === b);

  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "application/pdf"; // %PDF

  const ascii = (start: number, len: number) =>
    String.fromCharCode(...bytes.subarray(start, start + len));

  // RIFF....WEBP
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";

  if (bytes.length >= 12 && ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand === "heic" || brand === "heix" || brand === "hevc" || brand === "hevx") return "image/heic";
    if (brand === "mif1" || brand === "msf1" || brand === "heim" || brand === "heis") return "image/heif";
  }

  return null;
}
