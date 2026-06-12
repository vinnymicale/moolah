import { requireUser } from "@/lib/session";
import { getNetWorth, getSnapshots, getPlaidItems } from "@/lib/queries";
import { formatUSD } from "@/lib/money";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { AccountsManager } from "./AccountsManager";
import { PlaidConnectButton, PlaidItemsList } from "./PlaidLinkButton";
import { DEMO_ACCOUNTS, buildDemoSnapshots } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function AccountsPage() {
  if (DEMO_MODE) {
    const assets = DEMO_ACCOUNTS.filter((a) => a.isAsset && a.includeInNetWorth).reduce((s, a) => s + a.currentBalance, 0);
    const liabilities = DEMO_ACCOUNTS.filter((a) => !a.isAsset && a.includeInNetWorth).reduce((s, a) => s + a.currentBalance, 0);
    const snapshots = buildDemoSnapshots();
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Accounts & Net Worth" subtitle="Everything you own and owe, in one place." />
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <StatCard label="Net Worth" value={formatUSD(assets - liabilities)} tone="brand" />
          <StatCard label="Assets" value={formatUSD(assets)} tone="income" />
          <StatCard label="Liabilities" value={formatUSD(liabilities)} tone="expense" />
        </div>
        <AccountsManager accounts={DEMO_ACCOUNTS} snapshots={snapshots} />
      </div>
    );
  }

  const { userId } = await requireUser();
  const [netWorth, snapshots, plaidItems] = await Promise.all([
    getNetWorth(userId),
    getSnapshots(userId),
    getPlaidItems(userId),
  ]);

  const hasPlaid = !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Accounts & Net Worth"
        subtitle="Everything you own and owe, in one place."
        action={hasPlaid ? <PlaidConnectButton /> : undefined}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Net Worth" value={formatUSD(netWorth.net)} tone="brand" />
        <StatCard label="Assets" value={formatUSD(netWorth.assets)} tone="income" />
        <StatCard label="Liabilities" value={formatUSD(netWorth.liabilities)} tone="expense" />
      </div>

      <AccountsManager accounts={netWorth.accounts} snapshots={snapshots} />

      {hasPlaid && <PlaidItemsList items={plaidItems} />}
    </div>
  );
}
