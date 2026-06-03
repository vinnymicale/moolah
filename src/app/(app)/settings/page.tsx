import { requireHousehold } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { HouseholdNameForm, InviteCode, ExportData } from "./SettingsForm";

export default async function SettingsPage() {
  const { householdId } = await requireHousehold();
  const [household, accounts, categories] = await Promise.all([
    prisma.household.findUnique({
      where: { id: householdId },
      include: { users: { select: { id: true, name: true, email: true, image: true } } },
    }),
    getAccounts(householdId),
    getCategories(householdId),
  ]);
  if (!household) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Settings" subtitle="Manage your household and members." />

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
                <p className="truncate text-sm font-medium">{u.name ?? "—"}</p>
                <p className="truncate text-xs text-muted">{u.email}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
