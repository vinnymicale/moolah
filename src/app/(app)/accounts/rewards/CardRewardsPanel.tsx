"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { CapBar, Dot } from "@/components/ui-bits";
import { categoryLabel } from "@/lib/card-rewards/categories";
import { findCatalogCard } from "@/lib/card-rewards/catalog";
import { currentQuarter, findProgress, type CapProgressDTO } from "@/lib/card-rewards/rank";
import { ROTATING_CAP_KEY, type CapPeriod } from "@/lib/card-rewards/types";
import type { RewardCardDTO, RewardProfileDTO } from "@/lib/queries/card-rewards";
import {
  deleteRewardProfileAction,
  setCapProgressAction,
  setRotatingActivatedAction,
} from "@/actions/card-rewards";
import { formatRate, monthYear, periodLabel } from "./format";
import { RewardsEditorModal } from "./RewardsEditorModal";

type Props = {
  card: RewardCardDTO & { profile: RewardProfileDTO };
  progress: CapProgressDTO[];
  today: string;
  canManage: boolean;
};

export function CardRewardsPanel({ card, progress, today, canManage }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profile = card.profile;
  const date = new Date(today);
  const catalog = profile.catalogCardId ? findCatalogCard(profile.catalogCardId) : null;
  const unit = (rate: number) => formatRate(rate, profile.currency);

  const remove = async () => {
    if (!confirm(`Remove the rewards setup for ${card.name}?`)) return;
    setBusy(true);
    setError(null);
    const r = await deleteRewardProfileAction(profile.id);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  };

  const cappedRules = profile.rules.filter((r) => r.cap);

  return (
    <section className="card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-base font-semibold">
            <Dot color={card.color} />
            {card.name}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            {[
              profile.programName ?? (profile.currency === "CASH" ? "Cash back" : profile.currency === "MILES" ? "Miles" : "Points"),
              profile.currency !== "CASH" && `${profile.centsPerPoint}¢ per ${profile.currency === "MILES" ? "mile" : "point"}`,
              `${unit(profile.baseRate)} on everything else`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {catalog && (
            <p className="mt-0.5 text-xs text-muted">from catalog · verified {monthYear(catalog.verifiedAsOf)}</p>
          )}
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => setEditing(true)} disabled={busy}>
              <Pencil size={14} aria-hidden /> Edit
            </button>
            <button type="button" className="btn-ghost" onClick={remove} disabled={busy} aria-label={`Remove rewards for ${card.name}`}>
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {profile.rules.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {profile.rules.map((r) => (
            <span key={r.category} className="chip">
              {categoryLabel(r.category)} {unit(r.rate)}
            </span>
          ))}
        </div>
      )}

      {profile.rotating && (
        <RotatingSection
          profileId={profile.id}
          rotating={profile.rotating}
          progress={progress}
          date={date}
          unit={unit}
          canManage={canManage}
        />
      )}

      {cappedRules.length > 0 && (
        <div className="mt-4 space-y-3">
          {cappedRules.map((r) => (
            <CapEditor
              key={r.category}
              profileId={profile.id}
              capKey={r.category}
              label={`${categoryLabel(r.category)} ${unit(r.rate)}`}
              limit={r.cap!.amount}
              period={r.cap!.period}
              spent={findProgress(progress, profile.id, r.category, r.cap!.period, date)?.spent ?? 0}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-expense">{error}</p>}

      {canManage && (
        <RewardsEditorModal open={editing} onClose={() => setEditing(false)} cardName={card.name} profile={profile} />
      )}
    </section>
  );
}

function RotatingSection({
  profileId,
  rotating,
  progress,
  date,
  unit,
  canManage,
}: {
  profileId: string;
  rotating: NonNullable<RewardProfileDTO["rotating"]>;
  progress: CapProgressDTO[];
  date: Date;
  unit: (rate: number) => string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { year, quarter } = currentQuarter(date);
  const next = quarter === 4 ? { year: year + 1, quarter: 1 } : { year, quarter: quarter + 1 };
  const current = rotating.quarters.find((q) => q.year === year && q.quarter === quarter);
  const upcoming = rotating.quarters.find((q) => q.year === next.year && q.quarter === next.quarter);
  const row = findProgress(progress, profileId, ROTATING_CAP_KEY, "QUARTER", date);

  const toggle = async (activated: boolean) => {
    setBusy(true);
    setError(null);
    const r = await setRotatingActivatedAction(profileId, activated);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  };

  const names = (cats: string[]) => cats.map(categoryLabel).join(", ");

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Q{quarter} rotating {unit(rotating.rate)}:{" "}
          {current ? names(current.categories) : <span className="font-normal text-muted">Q{quarter} categories not set</span>}
        </p>
        {current && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={row?.activated ?? false}
              disabled={!canManage || busy}
              onChange={(e) => toggle(e.target.checked)}
            />
            Activated
          </label>
        )}
      </div>
      {upcoming && (
        <p className="mt-1 text-xs text-muted">
          Next up (Q{upcoming.quarter}): {names(upcoming.categories)}
        </p>
      )}
      {current && (
        <div className="mt-3">
          <CapEditor
            profileId={profileId}
            capKey={ROTATING_CAP_KEY}
            label={`Q${quarter} rotating cap`}
            limit={rotating.capAmount}
            period="QUARTER"
            spent={row?.spent ?? 0}
            canManage={canManage}
          />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-expense">{error}</p>}
    </div>
  );
}

function CapEditor({
  profileId,
  capKey,
  label,
  limit,
  period,
  spent,
  canManage,
}: {
  profileId: string;
  capKey: string;
  label: string;
  limit: number;
  period: CapPeriod;
  spent: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(spent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      setError("Enter a number");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await setCapProgressAction(profileId, capKey, amount);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setOpen(false);
      router.refresh();
    }
  };

  const hint = open ? (
    <form onSubmit={save} className="mt-1 flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={0}
        step="0.01"
        className="input w-32"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Spent toward ${label}`}
        autoFocus
      />
      <button type="submit" className="btn-primary" disabled={busy}>
        Save
      </button>
      <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </button>
    </form>
  ) : (
    <span>
      Spent this {periodLabel(period)}, from your card statement.{" "}
      {canManage && (
        <button
          type="button"
          className="underline hover:text-text"
          onClick={() => {
            setValue(String(spent));
            setOpen(true);
          }}
        >
          Update
        </button>
      )}
    </span>
  );

  return (
    <div>
      <CapBar label={label} used={spent} limit={limit} hint={hint} />
      {error && <p className="mt-1 text-sm text-expense">{error}</p>}
    </div>
  );
}
