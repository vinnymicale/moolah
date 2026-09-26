"use client";

import { useState } from "react";
import { categoryColor } from "@/lib/colors";
import { CategoryIcon } from "./CategoryIcon";

type Cat = { icon?: string | null; color?: string | null } | undefined;

/**
 * Square tile at the start of a transaction row: the merchant logo from Plaid
 * when there is one, otherwise the category icon. A logo that fails to load
 * falls back to the category icon too.
 */
export function TxnAvatar({ logoUrl, cat, size = "md" }: { logoUrl?: string | null; cat: Cat; size?: "sm" | "md" }) {
  const [broken, setBroken] = useState(false);
  const box = size === "sm" ? "h-8 w-8" : "h-9 w-9";

  if (logoUrl && !broken) {
    return (
      <span className={`${box} shrink-0 overflow-hidden rounded-lg border border-line bg-white`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote Plaid CDN, no need for next/image */}
        <img src={logoUrl} alt="" loading="lazy" className="h-full w-full object-contain" onError={() => setBroken(true)} />
      </span>
    );
  }

  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center rounded-lg`}
      style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}
    >
      <CategoryIcon name={cat?.icon ?? "tag"} size={size === "sm" ? 15 : 16} />
    </span>
  );
}
