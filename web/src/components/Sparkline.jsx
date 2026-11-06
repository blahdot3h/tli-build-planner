// DPS over the simulated fight: one point per 0.5 s
export default function Sparkline({ points, height = 64 }) {
  if (!points?.length) return null;
  const width = 300;
  const max = Math.max(...points.map((p) => p.dps), 1);
  const x = (i) => (i / Math.max(1, points.length - 1)) * width;
  const y = (v) => height - 2 - (v / max) * (height - 4);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.dps).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="DPS over the simulated fight">
      <polygon points={`0,${height} ${line} ${width},${height}`} className="spark-fill" />
      <polyline points={line} className="spark-line" />
    </svg>
  );
}
