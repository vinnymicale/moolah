"use client";

import Link from "next/link";
import { Check, Circle, Rocket, X } from "lucide-react";
import type { OnboardingStep } from "@/lib/onboarding";
import { useIsHydrated, usePersistentState } from "@/lib/usePersistentState";

const DISMISS_KEY = "onboardingDismissed";

/**
 * First-run setup checklist. The steps tick themselves off as the user actually
 * does them, so it doubles as a progress indicator rather than a list to click
 * through. Dismissing hides it for good on this browser; the page stops
 * rendering it entirely once every step is done, so a cleared localStorage
 * doesn't resurrect it for an established user.
 */
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const [dismissed, setDismissed] = usePersistentState<boolean>(DISMISS_KEY, false);
  const hydrated = useIsHydrated();

  // Avoid SSR mismatch - render nothing until localStorage is read.
  if (!hydrated || dismissed) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-brand/30 bg-gradient-to-br from-brand/10 to-transparent">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <Rocket size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text">Finish setting up Moolah</p>
          <p className="text-sm text-muted">
            {doneCount} of {steps.length} done
            {next && ` · next up: ${next.title.toLowerCase()}`}
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="btn-ghost h-7 w-7 shrink-0 p-0! text-muted"
          title="Dismiss"
          aria-label="Dismiss setup checklist"
        >
          <X size={15} />
        </button>
      </div>

      <ul className="border-t border-brand/20">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex items-center gap-3 border-b border-brand/10 px-4 py-2.5 last:border-0"
          >
            {step.done ? (
              <Check size={16} className="shrink-0 text-income" aria-hidden="true" />
            ) : (
              <Circle size={16} className="shrink-0 text-muted" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${step.done ? "text-muted line-through" : "text-text"}`}>
                {step.title}
              </p>
              {!step.done && <p className="text-xs text-muted">{step.detail}</p>}
            </div>
            {!step.done && (
              <Link href={step.href} className="btn-ghost h-8 shrink-0 text-xs">
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
