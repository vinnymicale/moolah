import Link from "next/link";
import { Info } from "lucide-react";

export type Tone = "default" | "income" | "expense" | "brand";

/** The text-color class for a semantic tone. */
export function toneTextClass(tone: Tone): string {
  return tone === "income" ? "text-income"
    : tone === "expense" ? "text-expense"
    : tone === "brand" ? "text-brand"
    : "text-text";
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  info,
  href,
  tone = "default",
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Explanatory text shown in a tooltip on an info icon next to the label. */
  info?: React.ReactNode;
  /** When set, the whole card becomes a link to a drill-through view. */
  href?: string;
  tone?: Tone;
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  const body = (
    <>
      <p className={`flex items-center gap-1 font-medium uppercase tracking-wide text-muted ${sm ? "text-[11px]" : "text-xs"}`}>
        <span>{label}</span>
        {info && <InfoTip text={info} />}
      </p>
      <p className={`font-semibold tabular-nums ${sm ? "text-lg" : "mt-1 text-2xl"} ${toneTextClass(tone)}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  const cls = `card ${sm ? "px-3 py-2" : "p-4"}`;
  if (href) {
    return (
      <Link href={href} className={`${cls} block transition-colors hover:border-brand/40 hover:bg-surface2`}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

/**
 * A small info icon that reveals explanatory text on hover or keyboard focus.
 * Pure CSS (group-hover/focus) so it needs no state or positioning library.
 */
export function InfoTip({ text }: { text: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex text-muted/70 hover:text-text focus:text-text focus:outline-none"
        aria-label="More info"
      >
        <Info size={13} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-40 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-line bg-surface p-2.5 text-xs font-normal normal-case tracking-normal text-text opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description?: string;
  cta?: { href?: string; label: string };
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {cta?.href && (
        <Link href={cta.href} className="btn-primary mt-4">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ backgroundColor: color, width: size, height: size }}
    />
  );
}
