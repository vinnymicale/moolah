import { describe, it, expect } from "vitest";
import {
  validateAttachmentUpload,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
} from "./attachments";

const ok = { mimeType: "image/jpeg", size: 1024, existingCount: 0 };

describe("validateAttachmentUpload", () => {
  it("accepts a small jpeg", () => {
    expect(validateAttachmentUpload(ok)).toBeNull();
  });

  it("accepts every allowed type", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]) {
      expect(validateAttachmentUpload({ ...ok, mimeType: t })).toBeNull();
    }
  });

  it("rejects disallowed types", () => {
    expect(validateAttachmentUpload({ ...ok, mimeType: "image/svg+xml" })).toMatch(/type/i);
    expect(validateAttachmentUpload({ ...ok, mimeType: "text/html" })).toMatch(/type/i);
    expect(validateAttachmentUpload({ ...ok, mimeType: "" })).toMatch(/type/i);
  });

  it("rejects files over the size cap", () => {
    expect(validateAttachmentUpload({ ...ok, size: MAX_ATTACHMENT_BYTES + 1 })).toMatch(/10MB/);
    expect(validateAttachmentUpload({ ...ok, size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });

  it("rejects empty files", () => {
    expect(validateAttachmentUpload({ ...ok, size: 0 })).toMatch(/empty/i);
  });

  it("rejects when the transaction is at the attachment cap", () => {
    expect(
      validateAttachmentUpload({ ...ok, existingCount: MAX_ATTACHMENTS_PER_TRANSACTION }),
    ).toMatch(/5/);
    expect(
      validateAttachmentUpload({ ...ok, existingCount: MAX_ATTACHMENTS_PER_TRANSACTION - 1 }),
    ).toBeNull();
  });
});
