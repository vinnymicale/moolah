import { requireUser } from "@/lib/session";
import { getCategories, getRules, getAccounts, type RuleDTO, type AccountDTO } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { CategoriesManager } from "./CategoriesManager";
import { RulesCard } from "./RulesCard";
import { DEMO_CATEGORIES } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function CategoriesPage() {
  let categories;
  let rules: RuleDTO[] = [];
  let accounts: AccountDTO[] = [];
  if (DEMO_MODE) {
    categories = DEMO_CATEGORIES;
  } else {
    const { userId } = await requireUser();
    [categories, rules, accounts] = await Promise.all([
      getCategories(userId),
      getRules(userId),
      getAccounts(userId),
    ]);
  }

  return (
    <div className="stagger mx-auto max-w-5xl">
      <PageHeader title="Categories" subtitle="Organize how you classify income and spending." />
      <CategoriesManager categories={categories} />
      {!DEMO_MODE && <RulesCard rules={rules} categories={categories} accounts={accounts} />}
    </div>
  );
}
