import { requireHousehold } from "@/lib/session";
import { getNetWorth, getSnapshots, getPlaidItems } from "@/lib/queries";
import { formatUSD } from "@/lib/money";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { AccountsManager } from "./AccountsManager";
import { PlaidConnectButton, PlaidItemsList } from "./PlaidLinkButton";

export default async function AccountsPage() {
  const { householdId } = await requireHousehold();
  const [netWorth, snapshots, plaidItems] = await Promise.all([
    getNetWorth(householdId),
    getSnapshots(householdId),
    getPlaidItems(householdId),
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
