/**
 * Find and remove duplicate Plaid transactions (same account/date/amount/type/
 * description, multiple non-deleted rows), keeping the oldest copy. This is the
 * CLI twin of the in-app dedup tool - useful on a self-hosted box where the only
 * access is a shell.
 *
 *   npx tsx scripts/dedup.ts                 # dry run, lists what would go
 *   npx tsx scripts/dedup.ts --apply         # hard-delete the duplicates
 *   npx tsx scripts/dedup.ts --apply --soft  # move them to the trash instead
 *
 * Targets every user by default; pass --user <id> to scope to one.
 */
import { prisma } from "../src/lib/prisma";
import { scanDuplicateTransactions, removeDuplicateTransactions } from "../src/lib/dedup-transactions";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const mode = args.includes("--soft") ? "soft" : "hard";
  const userArg = args.indexOf("--user");
  const onlyUser = userArg >= 0 ? args[userArg + 1] : null;

  const users = onlyUser
    ? [{ id: onlyUser }]
    : await prisma.user.findMany({ select: { id: true } });

  let grandTotal = 0;
  for (const u of users) {
    const { groups, removableCount } = await scanDuplicateTransactions(u.id);
    if (removableCount === 0) continue;
    grandTotal += removableCount;
    console.log(`\nUser ${u.id}: ${removableCount} duplicate copies across ${groups.length} charges`);
    for (const g of groups.slice(0, 50)) {
      console.log(`  ${g.date} | ${g.type} | ${g.amount} | ${g.description} | keep ${g.keepId}, remove ${g.removeIds.length}`);
    }
    if (groups.length > 50) console.log(`  ...and ${groups.length - 50} more charges`);

    if (apply) {
      // Every group the scan reported - groups the user ignored in the app are
      // already filtered out of it.
      const removed = await removeDuplicateTransactions(u.id, mode, groups.map((g) => g.keepId));
      console.log(`  -> ${mode === "hard" ? "deleted" : "trashed"} ${removed} rows`);
    }
  }

  console.log(`\n${apply ? "Removed" : "Would remove"} ${grandTotal} duplicate rows total (mode: ${mode}).`);
  if (!apply && grandTotal > 0) console.log("Re-run with --apply to act.");
  await prisma.$disconnect();
}
main();
