import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { ExportData, BackupData, AiConfigForm, PlaidConfigForm, ApiTokenForm } from "./SettingsForm";

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
        apiTokenHash: true,
        apiTokenCreatedAt: true,
      },
    }),
    getAccounts(userId),
    getCategories(userId),
  ]);
  if (!user) return null;

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
          hasToken={!!user.apiTokenHash}
          createdAt={user.apiTokenCreatedAt ? user.apiTokenCreatedAt.toISOString() : null}
        />
      </section>
    </div>
  );
}
