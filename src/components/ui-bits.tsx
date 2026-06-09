import Link from "next/link";

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
  tone = "default",
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  return (
    <div className={`card ${sm ? "px-3 py-2" : "p-4"}`}>
      <p className={`font-medium uppercase tracking-wide text-muted ${sm ? "text-[11px]" : "text-xs"}`}>{label}</p>
      <p className={`font-semibold tabular-nums ${sm ? "text-lg" : "mt-1 text-2xl"} ${toneTextClass(tone)}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
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
