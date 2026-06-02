import { requireHousehold } from "@/lib/session";
import { getCategories } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { CategoriesManager } from "./CategoriesManager";

export default async function CategoriesPage() {
  const { householdId } = await requireHousehold();
  const categories = await getCategories(householdId);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Categories" subtitle="Organize how you classify income and spending." />
      <CategoriesManager categories={categories} />
    </div>
  );
}
