import { headers } from "next/headers";
import { requireHousehold } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories } from "@/lib/queries";
import { getSetupStatus, isLocalHost } from "@/lib/setup-config";
import { PageHeader } from "@/components/ui-bits";
import { SetupPanel } from "@/app/(auth)/signin/SetupPanel";
import { HouseholdNameForm, InviteCode, ExportData, BackupData, AiConfigForm } from "./SettingsForm";

export default async function SettingsPage() {
  const { householdId } = await requireHousehold();
  const host = (await headers()).get("host");
  const status = getSetupStatus();
  const showPlaidSetup = isLocalHost(host);

  const [household, accounts, categories] = await Promise.all([
    prisma.household.findUnique({
      where: { id: householdId },
      select: {
        id: true, name: true, inviteCode: true,
        aiProvider: true,
        // Avoid leaking the actual key to the browser; just signal whether one is set.
        aiApiKey: true,
        users: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
    getAccounts(householdId),
    getCategories(householdId),
  ]);
  if (!household) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Settings" subtitle="Manage your household and members." />

      {showPlaidSetup && (
        <SetupPanel status={status} plaidOnly={process.env.AUTH_BYPASS === "true"} />
      )}

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Household</h2>
        <HouseholdNameForm initialName={household.name} />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Invite your partner</h2>
        <p className="mb-3 text-sm text-muted">
          Share this code so they can join from the welcome screen. Everyone in the household sees the same data.
        </p>
        <InviteCode code={household.inviteCode} />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Export your data</h2>
        <p className="mb-3 text-sm text-muted">
          Download your transactions as a CSV for taxes, backups, or spreadsheets.
        </p>
        <ExportData accounts={accounts} categories={categories} />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Back up everything</h2>
        <p className="mb-3 text-sm text-muted">
          Download a full backup - all your data <em>and</em> your linked bank connections - as one
          JSON file. Restore it on a new machine to keep your banks without re-linking. Keep the file
          private: it contains your bank access tokens.
        </p>
        <BackupData />
        <p className="mt-3 text-xs text-muted">
          To restore: in a fresh copy of the app, run{" "}
          <code className="rounded bg-surface2 px-1 py-0.5 text-text">npm run db:local</code> and{" "}
          <code className="rounded bg-surface2 px-1 py-0.5 text-text">npm run db:push</code>, then{" "}
          <code className="rounded bg-surface2 px-1 py-0.5 text-text">npm run db:restore -- &lt;file&gt;</code>{" "}
          pointing at this JSON. Your accounts and linked banks come back with no re-linking (it only
          restores into an empty database).
        </p>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Finance assistant</h2>
        <p className="mb-3 text-sm text-muted">
          Connect your own AI account to enable the chat assistant. Your key is stored only in this household&apos;s database and never shared.
        </p>
        <AiConfigForm
          currentProvider={household.aiProvider}
          hasKey={!!household.aiApiKey}
        />
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Members ({household.users.length})</h2>
        <ul className="divide-y divide-line">
          {household.users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2.5">
              {u.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.image} alt="" className="h-9 w-9 rounded-full" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 font-semibold text-brand">
                  {(u.name ?? u.email ?? "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{u.name ?? "-"}</p>
                <p className="truncate text-xs text-muted">{u.email}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
