import { STATUS_STYLE, worst, isMuted } from '../ui'

const HEADLINE = {
  ok: 'All systems normal',
  warn: 'Some things need attention',
  fail: 'Something is broken',
  unknown: 'Gathering status…'
}

export default function Banner({ results, alerts, onRerunAll, busy }) {
  const live = results.filter((r) => !isMuted(alerts[r.id]))
  const status = worst(live.map((r) => r.status))
  const count = (s) => results.filter((r) => r.status === s).length
  const s = STATUS_STYLE[status]
  const muted = results.length - live.length

  return (
    <section className={`rounded-xl ring-1 ${s.ring} bg-zinc-900/60 px-6 py-5 flex items-center gap-6`}>
      <div className={`w-4 h-4 rounded-full ${s.dot} ${status === 'fail' ? 'animate-pulse' : ''}`} />
      <div className="flex-1">
        <h1 className="text-xl font-semibold">{HEADLINE[status]}</h1>
        <p className="text-sm text-zinc-400 mt-0.5">
          <span className="text-red-400">{count('fail')} failing</span> ·{' '}
          <span className="text-amber-400">{count('warn')} warnings</span> ·{' '}
          <span className="text-emerald-400">{count('ok')} ok</span> ·{' '}
          <span>{count('unknown')} unknown</span>
          {muted > 0 && <span> · {muted} muted</span>}
        </p>
      </div>
      <button onClick={onRerunAll} disabled={busy}
        className="px-3.5 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50">
        {busy ? 'Running…' : '↻ Re-run all'}
      </button>
    </section>
  )
}
