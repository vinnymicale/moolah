import { requireHousehold } from "@/lib/session";
import { getCategories } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { CategoriesManager } from "./CategoriesManager";
import { DEMO_CATEGORIES } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function CategoriesPage() {
  const categories = DEMO_MODE ? DEMO_CATEGORIES : await getCategories((await requireHousehold()).householdId);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Categories" subtitle="Organize how you classify income and spending." />
      <CategoriesManager categories={categories} />
    </div>
  );
}
