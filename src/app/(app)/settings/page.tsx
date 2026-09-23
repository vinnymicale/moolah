import { requirePageAdmin } from "@/lib/household";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { ExportData } from "./sections/ExportData";
import { BackupData } from "./sections/BackupData";
import { RestoreData } from "./sections/RestoreData";
import { AiConfigForm } from "./sections/AiConfigForm";
import { PlaidConfigForm } from "./sections/PlaidConfigForm";
import { ApiTokenForm } from "./sections/ApiTokenForm";
import { ScheduledBackupForm } from "./sections/ScheduledBackupForm";
import { HouseholdMembers, type MemberRow } from "./sections/HouseholdMembers";
import { AuditLogView } from "./sections/AuditLogView";
import type { HouseholdRoleName } from "@/lib/capabilities";
import { scheduleFromCron } from "@/lib/backup/schedule";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function SettingsPage() {
  if (DEMO_MODE) {
    return (
      <div className="stagger mx-auto max-w-2xl space-y-5">
        <PageHeader title="Settings" subtitle="Demo mode — settings are read-only." />
        <section className="card p-5">
          <h2 className="mb-1 font-semibold">Demo mode</h2>
          <p className="text-sm text-muted">
            This is a live demo of Moolah. Settings, bank connections, and the AI assistant are
            disabled. Any changes you make to transactions, budgets, or goals are local to your
            browser session and reset on refresh.
          </p>
        </section>
      </div>
    );
  }

  const ctx = await requirePageAdmin();
  const { householdId } = ctx;

  // Credentials live on the household and are admin-only, so a member without
  // admin gets the same "not configured" view rather than a peek at the keys.
  const [household, accounts, categories, memberRows] = await Promise.all([
    ctx.isAdmin
      ? prisma.household.findUnique({
          where: { id: householdId },
          select: {
            aiProvider: true,
            aiModel: true,
            // Avoid leaking the actual keys to the browser; just signal whether they're set.
            aiApiKey: true,
            plaidClientId: true,
            plaidSecret: true,
            plaidEnv: true,
            apiTokenSelector: true,
            apiTokenCreatedAt: true,
          },
        })
      : null,
    getAccounts(householdId),
    getCategories(householdId),
    prisma.householdMember.findMany({
      where: { householdId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    }),
  ]);

  const members: MemberRow[] = memberRows.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name ?? "Unnamed",
    role: m.role as HouseholdRoleName,
    capabilities: m.capabilities,
    deniedCapabilities: m.deniedCapabilities,
    isOwner: m.role === "OWNER",
  }));

  const backupConfig = await prisma.backupConfig.findUnique({ where: { householdId } });
  const backupProps = {
    enabled: backupConfig?.enabled ?? false,
    destination: backupConfig?.destination ?? "local",
    schedule: scheduleFromCron(backupConfig?.cron ?? "0 3 * * *"),
    keepCount: backupConfig?.keepCount ?? 7,
    gdriveConnected: !!backupConfig?.credentials,
    lastRunAt: backupConfig?.lastRunAt ? backupConfig.lastRunAt.toISOString() : null,
    lastStatus: backupConfig?.lastStatus ?? null,
    lastError: backupConfig?.lastError ?? null,
    lastBackupName: backupConfig?.lastBackupName ?? null,
  };

  const envFallback = !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);

  return (
    <div className="stagger mx-auto max-w-2xl space-y-5">
      <PageHeader title="Settings" subtitle="Manage your data, exports, and integrations." />

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Household members</h2>
        <p className="mb-3 text-sm text-muted">
          Everyone here shares one ledger. Roles set what a person can reach by default, and the
          permissions editor overrides that per person. Settings, bank credentials and membership
          stay with admins.
        </p>
        <HouseholdMembers members={members} viewerIsOwner={ctx.role === "OWNER"} />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Plaid bank sync</h2>
        <p className="mb-3 text-sm text-muted">
          Connect your own Plaid account to link banks and sync balances and transactions
          automatically. Sandbox uses fake test banks; Production connects your real banks.
        </p>
        <PlaidConfigForm
          currentClientId={household?.plaidClientId ?? null}
          hasSecret={!!household?.plaidSecret}
          currentEnv={household?.plaidEnv ?? null}
          envFallback={envFallback}
        />
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
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Restore from a backup</h2>
        <p className="mb-3 text-sm text-muted">
          Import a backup file to move an existing instance here - e.g. into a fresh Docker container
          - with no data loss or reconfiguration. This is a full replace: it wipes this instance and
          loads everything from the file, including your accounts, transactions, and Plaid keys, so
          your linked banks keep working without re-linking. You&apos;ll be signed out afterward; log
          back in with the account from the backup.
        </p>
        <RestoreData />
        <p className="mt-3 text-xs text-muted">
          Prefer the command line? On the server you can still run{" "}
          <code className="rounded bg-surface2 px-1 py-0.5 text-text">npm run db:restore -- &lt;file&gt;</code>{" "}
          against an empty database.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Scheduled backups</h2>
        <p className="mb-3 text-sm text-muted">
          Run full backups automatically on a schedule and keep a rolling number of copies. This runs
          on the server itself, so it&apos;s meant for an always-on / self-hosted setup rather than
          serverless.
        </p>
        <ScheduledBackupForm config={backupProps} />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Finance assistant</h2>
        <p className="mb-3 text-sm text-muted">
          Connect your own AI account to enable the chat assistant. Your key is stored only in your
          own database and never shared.
        </p>
        <AiConfigForm
          currentProvider={household?.aiProvider ?? null}
          currentModel={household?.aiModel ?? null}
          hasKey={!!household?.aiApiKey}
        />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Read-only API access</h2>
        <p className="mb-3 text-sm text-muted">
          Generate a personal token so external tools like Home Assistant can read your net worth,
          budget status, and upcoming bills over your network. The token grants read-only access.
        </p>
        <ApiTokenForm
          hasToken={!!household?.apiTokenSelector}
          createdAt={household?.apiTokenCreatedAt ? household.apiTokenCreatedAt.toISOString() : null}
        />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Activity</h2>
        <p className="mb-3 text-sm text-muted">
          The last 50 changes anyone in the household made. Credential entries name the setting, never
          the value.
        </p>
        <AuditLogView householdId={householdId} />
      </section>
    </div>
  );
}
