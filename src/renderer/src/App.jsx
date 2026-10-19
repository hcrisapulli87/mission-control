import { useCallback, useEffect, useMemo, useState } from 'react'
import Banner from './components/Banner'
import AreaCard from './components/AreaCard'
import DetailPanel from './components/DetailPanel'
import Settings from './components/Settings'

export default function App() {
  const [data, setData] = useState({ areas: [], results: [], alerts: {}, now: Date.now() })
  const [view, setView] = useState('dashboard')
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [, setClock] = useState(0)

  const load = useCallback(async () => setData(await window.mc.getResults()), [])

  useEffect(() => {
    load()
    const offUpdate = window.mc.onUpdate(load)
    const offNav = window.mc.onNavigate((id) => { setView('dashboard'); setSelected(id) })
    const tick = setInterval(() => setClock((c) => c + 1), 15_000) // keep "checked 2m ago" fresh
    return () => { offUpdate(); offNav(); clearInterval(tick) }
  }, [load])

  const byArea = useMemo(() => {
    const m = {}
    for (const r of data.results) (m[r.area] ??= []).push(r)
    return m
  }, [data.results])

  const rerunAll = async () => {
    setBusy(true)
    try { await window.mc.rerun(null) } finally { setBusy(false) }
  }

  const selectedResult = data.results.find((r) => r.id === selected) ?? null

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-6 px-6 h-14 border-b border-zinc-800/80 bg-[#0d1017]">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px] shadow-emerald-500/60" />
          <span className="font-semibold tracking-wide">Mission Control</span>
        </div>
        <nav className="flex gap-1 text-sm">
          {['dashboard', 'settings'].map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md capitalize ${view === v ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {v}
            </button>
          ))}
        </nav>
      </header>

      {view === 'dashboard' ? (
        <div className="flex-1 flex min-h-0">
          <main className="flex-1 overflow-y-auto p-6 space-y-5">
            <Banner results={data.results} alerts={data.alerts} onRerunAll={rerunAll} busy={busy} />
            <div className="grid gap-5 xl:grid-cols-2">
              {data.areas.map((a) => (
                <AreaCard key={a.id} area={a} results={byArea[a.id] ?? []} alerts={data.alerts}
                  selected={selected} onSelect={setSelected} />
              ))}
            </div>
          </main>
          {selectedResult && (
            <DetailPanel result={selectedResult} alert={data.alerts[selectedResult.id]}
              onClose={() => setSelected(null)} onChanged={load} />
          )}
        </div>
      ) : (
        <Settings />
      )}
    </div>
  )
}
