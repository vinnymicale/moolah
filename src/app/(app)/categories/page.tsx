import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getCategories, getRules, getAccounts, getTags, type RuleDTO, type AccountDTO, type TagDTO } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { CategoriesManager } from "./CategoriesManager";
import { RulesCard } from "./RulesCard";
import { TagsManager } from "./TagsManager";
import { DEMO_CATEGORIES, DEMO_TAGS } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  // Rules don't exist in demo mode, so fall back to the categories tab there.
  const active = tab === "tags" ? "tags" : tab === "rules" && !DEMO_MODE ? "rules" : "categories";

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
      <PageHeader title="Categories & Rules" subtitle="Organize categories, tags and automation rules." />

      <div className="mb-5 flex w-fit gap-1 rounded-lg border border-line bg-surface2 p-1 text-sm">
        <Link
          href="/categories"
          className={`rounded-md px-3 py-1 ${active === "categories" ? "bg-surface font-medium" : "text-muted"}`}
        >
          Categories
        </Link>
        <Link
          href="/categories?tab=tags"
          className={`rounded-md px-3 py-1 ${active === "tags" ? "bg-surface font-medium" : "text-muted"}`}
        >
          Tags
        </Link>
        {!DEMO_MODE && (
          <Link
            href="/categories?tab=rules"
            className={`rounded-md px-3 py-1 ${active === "rules" ? "bg-surface font-medium" : "text-muted"}`}
          >
            Rules
          </Link>
        )}
      </div>

      {active === "tags" ? (
        <TagsManager tags={tags} />
      ) : active === "rules" ? (
        <RulesCard rules={rules} categories={categories} accounts={accounts} tags={tags} />
      ) : (
        <CategoriesManager categories={categories} />
      )}
    </div>
  );
}
