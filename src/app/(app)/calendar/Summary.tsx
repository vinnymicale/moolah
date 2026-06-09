export function Summary({ label, value, tone }: { label: string; value: string; tone: "default" | "income" | "expense" }) {
  const color = tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "text-text";
  return (
    <div className="card px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
