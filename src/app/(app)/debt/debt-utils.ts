export function payoffDateLabel(months: number): string {
  if (months <= 0) return "";
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return `by ${d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
}
