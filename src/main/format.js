export function fmtDuration(ms) {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

export const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
