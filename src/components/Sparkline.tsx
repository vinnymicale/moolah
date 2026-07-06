/**
 * Inline SVG micro-chart: a single trend line, no axes or labels. Strokes with
 * `currentColor` so callers pick the tone with a text-* class.
 */
export function Sparkline({
  values,
  width = 72,
  height = 22,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = 2;
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const norm = span === 0 ? 0.5 : (v - min) / span;
      const y = pad + (1 - norm) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      <polyline
        points={points}
        pathLength={1}
        className="sparkline-draw"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
