// Minimal SVG line chart: one series, min/max labels, latest value.
export default function LineChart({ name, points, height = 70 }) {
  if (points.length < 2) {
    return <div className="text-xs text-zinc-500 py-3">{name}: not enough history yet</div>
  }
  const W = 320
  const xs = points.map((p) => p.ts)
  const ys = points.map((p) => p.value)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  if (y0 === y1) { y0 -= 1; y1 += 1 }
  const px = (x) => ((x - x0) / (x1 - x0 || 1)) * W
  const py = (y) => height - 4 - ((y - y0) / (y1 - y0)) * (height - 8)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.ts).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ')
  const latest = ys.at(-1)
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="text-zinc-400">{name}</span>
        <span className="text-zinc-200 font-medium tabular-nums">{Math.round(latest * 10) / 10}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <path d={`${d} L${W},${height} L0,${height} Z`} fill="rgb(56 189 248 / 0.08)" />
        <path d={d} fill="none" stroke="rgb(56 189 248)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-500 tabular-nums">
        <span>min {Math.round(Math.min(...ys) * 10) / 10}</span>
        <span>max {Math.round(Math.max(...ys) * 10) / 10}</span>
      </div>
    </div>
  )
}
