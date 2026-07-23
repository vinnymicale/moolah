// Streams the attachments of the currently-filtered transactions as a single
// store-mode ZIP plus a manifest.csv. Re-runs the same range + filters as the
// sibling CSV export (./export/route.ts) so the archive matches the page.

import type { NextRequest } from "next/server";
import { Zip, ZipPassThrough } from "fflate";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories, getTransactionsBetween, type TransactionDTO } from "@/lib/queries";
import { userTodayISO } from "@/lib/user-tz";
import { resolveTransactionsRange } from "../resolve-range";
import { parseTransactionFilters } from "../transactions-utils";
import {
  MANIFEST_HEADER,
  buildZipFilename,
  dedupeFilenames,
  manifestRow,
  toCsv,
  type ZipAttachmentMeta,
  type ZipTxnMeta,
} from "@/lib/attachment-zip";

const DEMO_MODE = process.env.DEMO_MODE === "true";
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 5000;

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  if (DEMO_MODE) {
    return text("Attachments aren't available in demo mode.", 200);
  }

  const params = Object.fromEntries(req.nextUrl.searchParams) as Record<string, string>;
  const userId = (await requireUser()).userId;
  const todayISO = await userTodayISO();
  const { startISO, endISO, slug } = resolveTransactionsRange(params, todayISO);
  const filters = parseTransactionFilters(params);

  const [accounts, categories] = await Promise.all([
    getAccounts(userId),
    getCategories(userId),
  ]);
  const acctById = new Map(accounts.map((a) => [a.id, a.name]));
  const catById = new Map(categories.map((c) => [c.id, c.name]));

  const transactions: TransactionDTO[] = await getTransactionsBetween(
    userId,
    startISO,
    endISO,
    filters,
  );

  // Metadata pass: build the (txn, attachment) work list and tally the cap.
  type Entry = { txn: ZipTxnMeta; att: ZipAttachmentMeta };
  const entries: Entry[] = [];
  let totalBytes = 0;
  for (const t of transactions) {
    if (t.attachments.length === 0) continue;
    const txn: ZipTxnMeta = {
      id: t.id,
      type: t.type,
      amount: t.amount,
      date: t.date,
      description: t.description,
      note: t.note,
      categoryName: t.categoryId ? catById.get(t.categoryId) ?? "" : "",
      accountName: t.accountId ? acctById.get(t.accountId) ?? "" : "",
      tags: t.tags.map((x) => x.name),
      cleared: t.cleared,
    };
    for (const a of t.attachments) {
      entries.push({ txn, att: { id: a.id, filename: a.filename } });
      totalBytes += a.size;
    }
  }

  if (entries.length === 0) {
    return text("No attachments match these filters.", 409);
  }
  if (entries.length > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
    return text(
      "This selection is too large to export at once. Narrow the date range or filters and try again.",
      413,
    );
  }

  const names = dedupeFilenames(entries.map((e) => buildZipFilename(e.txn, e.att)));
  const manifest = toCsv([
    MANIFEST_HEADER,
    ...entries.map((e, i) => manifestRow(names[i], e.txn, e.att)),
  ]);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });

      void (async () => {
        try {
          // manifest.csv first.
          const manifestFile = new ZipPassThrough("manifest.csv");
          zip.add(manifestFile);
          manifestFile.push(new TextEncoder().encode(manifest), true);

          // Then each attachment, fetching bytes one at a time so we never hold
          // the whole selection in memory at once.
          for (let i = 0; i < entries.length; i++) {
            const row = await prisma.attachment.findFirst({
              where: { id: entries[i].att.id, userId },
              select: { data: true },
            });
            const file = new ZipPassThrough(names[i]);
            zip.add(file);
            file.push(new Uint8Array(row?.data ?? Buffer.alloc(0)), true);
          }
          zip.end();
        } catch (e) {
          controller.error(e);
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="attachments-${slug}.zip"`,
    },
  });
}
