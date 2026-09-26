import Link from "next/link";

const TABS = [
  { key: "accounts", label: "Accounts", href: "/accounts" },
  { key: "rewards", label: "Card Rewards", href: "/accounts/rewards" },
] as const;

export function AccountsTabs({ active }: { active: "accounts" | "rewards" }) {
  return (
    <nav className="mb-5 inline-flex rounded-full border border-line bg-surface p-1 text-sm">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 font-medium transition-colors ${
              isActive ? "bg-surface2 text-text" : "text-muted hover:text-text"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
