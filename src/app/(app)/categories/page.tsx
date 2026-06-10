import { requireHousehold } from "@/lib/session";
import { getCategories, getCategoryRules, type CategoryRuleDTO } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { CategoriesManager } from "./CategoriesManager";
import { CategoryRulesCard } from "./CategoryRulesCard";
import { DEMO_CATEGORIES } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function CategoriesPage() {
  let categories;
  let rules: CategoryRuleDTO[] = [];
  if (DEMO_MODE) {
    categories = DEMO_CATEGORIES;
  } else {
    const { householdId } = await requireHousehold();
    [categories, rules] = await Promise.all([
      getCategories(householdId),
      getCategoryRules(householdId),
    ]);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Categories" subtitle="Organize how you classify income and spending." />
      <CategoriesManager categories={categories} />
      <CategoryRulesCard rules={rules} categories={categories} />
    </div>
  );
}
