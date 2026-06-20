import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { ExportData, BackupData, RestoreData, AiConfigForm, PlaidConfigForm, ApiTokenForm, ScheduledBackupForm } from "./SettingsForm";
import { scheduleFromCron } from "@/lib/backup/schedule";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function SettingsPage() {
  if (DEMO_MODE) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
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

  const { userId } = await requireUser();

  const [user, accounts, categories] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        aiProvider: true,
        // Avoid leaking the actual keys to the browser; just signal whether they're set.
        aiApiKey: true,
        plaidClientId: true,
        plaidSecret: true,
        plaidEnv: true,
        apiTokenSelector: true,
        apiTokenCreatedAt: true,
      },
    }),
    getAccounts(userId),
    getCategories(userId),
  ]);
  if (!user) return null;

  const backupConfig = await prisma.backupConfig.findUnique({ where: { userId } });
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
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Settings" subtitle="Manage your data, exports, and integrations." />

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Plaid bank sync</h2>
        <p className="mb-3 text-sm text-muted">
          Connect your own Plaid account to link banks and sync balances and transactions
          automatically. Sandbox uses fake test banks; Production connects your real banks.
        </p>
        <PlaidConfigForm
          currentClientId={user.plaidClientId}
          hasSecret={!!user.plaidSecret}
          currentEnv={user.plaidEnv}
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
          currentProvider={user.aiProvider}
          hasKey={!!user.aiApiKey}
        />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Read-only API access</h2>
        <p className="mb-3 text-sm text-muted">
          Generate a personal token so external tools like Home Assistant can read your net worth,
          budget status, and upcoming bills over your network. The token grants read-only access.
        </p>
        <ApiTokenForm
          hasToken={!!user.apiTokenSelector}
          createdAt={user.apiTokenCreatedAt ? user.apiTokenCreatedAt.toISOString() : null}
        />
      </section>
    </div>
  );
}
