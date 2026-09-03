import { describe, it, expect } from "vitest";
import {
  validateAttachmentUpload,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  ALLOWED_ATTACHMENT_TYPES,
  sniffAttachmentType,
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

describe("sniffAttachmentType", () => {
  const bytes = (...parts: (number | string)[]) => {
    const out: number[] = [];
    for (const p of parts) {
      if (typeof p === "number") out.push(p);
      else for (const ch of p) out.push(ch.charCodeAt(0));
    }
    return new Uint8Array(out);
  };

  it("identifies JPEG, PNG and PDF from their signatures", () => {
    expect(sniffAttachmentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffAttachmentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffAttachmentType(bytes("%PDF-1.7"))).toBe("application/pdf");
  });

  it("identifies WebP by the RIFF container plus the WEBP tag", () => {
    expect(sniffAttachmentType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image/webp");
    // RIFF with a different payload tag (a WAV) is not an accepted format.
    expect(sniffAttachmentType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
  });

  it("reads the ISO-BMFF brand to tell HEIC from HEIF", () => {
    expect(sniffAttachmentType(bytes(0, 0, 0, 0x18, "ftyp", "heic"))).toBe("image/heic");
    expect(sniffAttachmentType(bytes(0, 0, 0, 0x18, "ftyp", "mif1"))).toBe("image/heif");
    // An MP4 is the same container with a brand we do not accept.
    expect(sniffAttachmentType(bytes(0, 0, 0, 0x18, "ftyp", "isom"))).toBeNull();
  });

  it("returns null for markup, empty input and truncated signatures", () => {
    expect(sniffAttachmentType(bytes("<script>alert(1)</script>"))).toBeNull();
    expect(sniffAttachmentType(new Uint8Array())).toBeNull();
    expect(sniffAttachmentType(bytes(0xff, 0xd8))).toBeNull();
  });

  it("only ever returns a type the upload allowlist accepts", () => {
    const hits = [
      bytes(0xff, 0xd8, 0xff),
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      bytes("%PDF"),
      bytes("RIFF", 0, 0, 0, 0, "WEBP"),
      bytes(0, 0, 0, 0x18, "ftyp", "heic"),
      bytes(0, 0, 0, 0x18, "ftyp", "msf1"),
    ];
    for (const b of hits) {
      const type = sniffAttachmentType(b);
      expect(type).not.toBeNull();
      expect(ALLOWED_ATTACHMENT_TYPES.has(type!)).toBe(true);
    }
  });
});
