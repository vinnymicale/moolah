"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Dot } from "@/components/ui-bits";
import { CATALOG, matchCatalogCard } from "@/lib/card-rewards/catalog";
import { createRewardProfileAction } from "@/actions/card-rewards";
import type { RewardCardDTO } from "@/lib/queries/card-rewards";

const CUSTOM = "__custom";

export function SetupRewards({ card }: { card: RewardCardDTO }) {
  const router = useRouter();
  const match = matchCatalogCard(card.officialName, card.name);
  const [choice, setChoice] = useState(match?.id ?? CUSTOM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (catalogCardId: string | null) => {
    setBusy(true);
    setError(null);
    const r = await createRewardProfileAction(card.accountId, catalogCardId);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  };

  return (
    <section className="card p-4 md:p-5">
      <h3 className="flex items-center gap-2 font-display text-base font-semibold">
        <Dot color={card.color} />
        {card.name}
      </h3>
      <p className="mt-0.5 text-sm text-muted">No rewards set up yet.</p>

      {match && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface2 p-3 text-sm">
          <Sparkles size={14} aria-hidden />
          <span>
            Looks like a <strong>{match.issuer} {match.name}</strong>.
          </span>
          <button type="button" className="btn-primary" onClick={() => create(match.id)} disabled={busy}>
            Use it
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[12rem]">
          <span className="label">{match ? "Or pick a card" : "Pick a card"}</span>
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy}>
            {CATALOG.map((c) => (
              <option key={c.id} value={c.id}>
                {c.issuer} {c.name}
              </option>
            ))}
            <option value={CUSTOM}>Custom (enter rates yourself)</option>
          </select>
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => create(choice === CUSTOM ? null : choice)}
          disabled={busy}
        >
          Set up rewards
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-expense">{error}</p>}
    </section>
  );
}
