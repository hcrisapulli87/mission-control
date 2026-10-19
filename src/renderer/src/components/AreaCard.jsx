import { STATUS_STYLE, worst, isMuted } from '../ui'
import CheckRow from './CheckRow'

const ORDER = { fail: 0, warn: 1, unknown: 2, ok: 3 }

export default function AreaCard({ area, results, alerts, selected, onSelect }) {
  const status = worst(results.filter((r) => !isMuted(alerts[r.id])).map((r) => r.status))
  const rows = [...results].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.title.localeCompare(b.title))
  return (
    <section className="rounded-xl bg-zinc-900/50 ring-1 ring-zinc-800">
      <header className="flex items-center gap-2.5 px-4 h-11 border-b border-zinc-800">
        <span className={`w-2 h-2 rounded-full ${STATUS_STYLE[status].dot}`} />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">{area.title}</h2>
        <span className="ml-auto text-xs text-zinc-500">{results.length} checks</span>
      </header>
      <div className="divide-y divide-zinc-800/70">
        {rows.length === 0 && <p className="px-4 py-3 text-sm text-zinc-500">Waiting for first run…</p>}
        {rows.map((r) => (
          <CheckRow key={r.id} result={r} alert={alerts[r.id]} active={selected === r.id} onSelect={() => onSelect(r.id)} />
        ))}
      </div>
    </section>
  )
}
