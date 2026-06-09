export function StatBox({ label, value, tone, hint }: { label: string; value: string; tone: "brand" | "income" | "expense"; hint: string }) {
  const color = tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "text-brand";
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}
