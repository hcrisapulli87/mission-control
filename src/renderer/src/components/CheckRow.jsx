import { useState } from 'react'
import { STATUS_STYLE, ago, isMuted } from '../ui'
import Shortcuts from './Shortcuts'

export default function CheckRow({ result, alert, active, onSelect }) {
  const [running, setRunning] = useState(false)
  const s = STATUS_STYLE[result.status]
  const muted = isMuted(alert)

  const rerun = async (e) => {
    e.stopPropagation()
    setRunning(true)
    try { await window.mc.rerun(result.id) } finally { setRunning(false) }
  }

  return (
    <div onClick={onSelect}
      className={`group px-4 py-2.5 flex items-start gap-3 cursor-pointer ${active ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'} ${muted ? 'opacity-60' : ''}`}>
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${s.dot}`} title={s.label} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{result.title}</span>
          {muted && <span className="text-[10px] uppercase tracking-wide text-zinc-500">muted</span>}
          <span className="ml-auto text-[11px] text-zinc-500 shrink-0">{ago(result.checkedAt)}</span>
        </div>
        <p className={`text-[13px] truncate ${result.status === 'ok' ? 'text-zinc-400' : s.text}`} title={result.summary}>
          {result.summary}
        </p>
        {result.status !== 'ok' && result.guide && (
          <button onClick={onSelect} className="mt-1 text-[11px] text-sky-400 hover:text-sky-300">How to fix ›</button>
        )}
        {result.shortcuts?.length > 0 && result.status !== 'ok' && (
          <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
            <Shortcuts shortcuts={result.shortcuts} />
          </div>
        )}
      </div>
      <button onClick={rerun} disabled={running} title="Re-run now"
        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-white text-sm px-1 disabled:opacity-100">
        <span className={running ? 'inline-block animate-spin' : ''}>↻</span>
      </button>
    </div>
  )
}
