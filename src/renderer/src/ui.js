export const STATUS_STYLE = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-400', ring: 'ring-emerald-500/30', label: 'OK' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-400', ring: 'ring-amber-500/30', label: 'Warning' },
  fail: { dot: 'bg-red-500', text: 'text-red-400', ring: 'ring-red-500/40', label: 'Failing' },
  unknown: { dot: 'bg-zinc-600', text: 'text-zinc-400', ring: 'ring-zinc-600/30', label: 'Unknown' }
}

const RANK = { unknown: 0, ok: 1, warn: 2, fail: 3 }
export const worst = (ss) => ss.reduce((a, s) => (RANK[s] > RANK[a] ? s : a), 'unknown')

export function ago(ts, now = Date.now()) {
  if (!ts) return 'never'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—')

export const isMuted = (a, now = Date.now()) => !!a && (a.muteUntilRecover || a.mutedUntil > now)
