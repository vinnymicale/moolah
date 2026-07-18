# Receipt & Document Attachments - Design

Date: 2026-07-18
Status: Approved

## Summary

Upload a photo or PDF of a receipt and attach it to a transaction, so refunds, warranties,
and expense reports have proof on hand. V1 is transactions-only: no standalone documents
library. Files are stored as bytea in the existing Postgres database so the feature works
identically on the Vercel demo and self-hosted Docker deploys, and rides along with the
existing whole-schema backup dump.

## Data model

New `Attachment` model in `prisma/schema.prisma`:

```prisma
model Attachment {
  id            String      @id @default(cuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  transactionId String
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  filename      String
  mimeType      String
  size          Int
  data          Bytes

  createdAt     DateTime    @default(now())

  @@index([transactionId])
  @@index([userId])
}
```

`Transaction` gains `attachments Attachment[]`. Permanent transaction delete cascades to
attachments; soft delete (trash) leaves them in place so restore brings them back intact.

## Limits and validation

- Accepted types: JPEG, PNG, WebP, HEIC, PDF. Validated server-side by MIME type and
  extension; anything else rejected.
- Max 10MB per file (post-compression, enforced server-side).
- Max 5 attachments per transaction, enforced server-side.
- Client-side image downscaling before upload: canvas re-encode to JPEG, max dimension
  2000px, quality ~0.85. Phone photos land around 0.5-1MB. PDFs upload as-is. HEICs the
  browser can't decode (non-Safari) upload as originals if under the cap.

## API

Route handlers rather than server actions: downloads need a GET endpoint anyway, and
server actions default to a 1MB body cap.

- `POST /api/attachments` - multipart form (`transactionId`, `file`). Session auth via the
  existing helper, demo-mode guard returns ok without persisting, validates ownership of
  the transaction, type, size, and the per-transaction cap. Returns the created
  attachment's metadata (id, filename, mimeType, size).
- `GET /api/attachments/[id]` - streams the bytes with the stored content-type and
  `Content-Disposition: inline`. Scoped to the session user's rows; 404 otherwise.
- `DELETE /api/attachments/[id]` - scoped to the session user's rows.

All three follow the auth and error patterns already used by the app's route handlers.

## UI

- `TransactionModal` gains an Attachments section: image thumbnails, a file chip for
  PDFs, add via file picker or drag-drop. The file input carries the `capture` hint so
  phones offer the camera. Delete has a confirm step.
- On create, files are staged in memory and uploaded right after
  `createTransactionAction` returns the new id, so "add expense + snap receipt" is one
  pass. If an upload fails after the save, the transaction stays and the user sees a
  toast naming the failed file.
- Transaction list rows with attachments show a small paperclip; the list query gains an
  attachment count (metadata only, never the bytes).
- Clicking an image thumbnail opens a lightbox; PDFs open in a new tab via the GET
  endpoint.

## Demo mode

Uploads and deletes return ok without persisting, matching the existing `isDemoMode()`
pattern in server actions. The demo dataset ships without attachments.

## Backups

The backup export dumps every table generically over a raw pg connection, so the new
table is included automatically - but bytea columns come back as Node Buffers, which
JSON-stringify into `{type:"Buffer",data:[...]}` objects. Export gains explicit
base64 encoding for Buffer values and import decodes them back, so attachment bytes
survive the round-trip. This is in scope because without it, backups containing
attachments would silently corrupt.

## Testing

- Unit tests: upload validation (type, size, cap), backup bytea round-trip.
- Route handler tests for auth scoping and demo-mode behavior, following the existing
  `api-auth` test patterns.
- Client image-downscale logic tested where practical; the canvas path is exercised
  manually via the verify skill.

## Out of scope

- Standalone documents library / unattached files.
- OCR or receipt-total extraction.
- Attachment support in the read-only /api/v1 API (can be added later as a thin wrapper).
