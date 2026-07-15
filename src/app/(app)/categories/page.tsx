import { requireUser } from "@/lib/session";
import { getCategories, getRules, getAccounts, getTags, type RuleDTO, type AccountDTO, type TagDTO } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { CategoriesManager } from "./CategoriesManager";
import { RulesCard } from "./RulesCard";
import { DEMO_CATEGORIES, DEMO_TAGS } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function CategoriesPage() {
  let categories;
  let rules: RuleDTO[] = [];
  let accounts: AccountDTO[] = [];
  let tags: TagDTO[] = [];
  if (DEMO_MODE) {
    categories = DEMO_CATEGORIES;
    tags = DEMO_TAGS;
  } else {
    const { userId } = await requireUser();
    [categories, rules, accounts, tags] = await Promise.all([
      getCategories(userId),
      getRules(userId),
      getAccounts(userId),
      getTags(userId),
    ]);
  }

  return (
    <div className="stagger mx-auto max-w-5xl">
      <PageHeader title="Categories" subtitle="Organize how you classify income and spending." />
      <CategoriesManager categories={categories} />
      {!DEMO_MODE && <RulesCard rules={rules} categories={categories} accounts={accounts} tags={tags} />}
    </div>
  );
}
