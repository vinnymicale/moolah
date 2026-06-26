// Placeholder shown in a chart's reserved height until recharts has mounted and
// measured, so charts fade in instead of popping in and the layout never shifts.
export function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="flex w-full items-end gap-2 overflow-hidden rounded-lg motion-safe:animate-pulse"
      style={{ height }}
      aria-hidden
    >
      {[40, 65, 50, 80, 60, 90, 70].map((h, i) => (
        <div key={i} className="flex-1 rounded-t bg-surface2" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
