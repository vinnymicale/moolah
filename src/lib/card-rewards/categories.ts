export const REWARD_CATEGORIES = [
  { key: "DINING", label: "Dining" },
  { key: "GROCERIES", label: "Groceries" },
  { key: "GAS", label: "Gas" },
  { key: "EV_CHARGING", label: "EV charging" },
  { key: "TRAVEL", label: "Travel" },
  { key: "TRANSIT", label: "Transit" },
  { key: "STREAMING", label: "Streaming" },
  { key: "DRUGSTORES", label: "Drugstores" },
  { key: "ONLINE_SHOPPING", label: "Online shopping" },
  { key: "WAREHOUSE_CLUBS", label: "Warehouse clubs" },
  { key: "HOME_IMPROVEMENT", label: "Home improvement" },
  { key: "ENTERTAINMENT", label: "Entertainment" },
  { key: "UTILITIES", label: "Utilities" },
] as const;

export type RewardCategoryKey = (typeof REWARD_CATEGORIES)[number]["key"];

export const REWARD_CATEGORY_KEYS = REWARD_CATEGORIES.map((c) => c.key) as [
  RewardCategoryKey,
  ...RewardCategoryKey[],
];

export function categoryLabel(key: string): string {
  return REWARD_CATEGORIES.find((c) => c.key === key)?.label ?? "Everything else";
}
