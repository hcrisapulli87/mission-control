import { useEffect, useState } from 'react'
import { STATUS_STYLE, ago, fmtTime, isMuted } from '../ui'
import Shortcuts from './Shortcuts'
import LineChart from './LineChart'
import FixGuide from './FixGuide'

const DAY = 86_400_000

const Dot = ({ status }) => <span className={`inline-block w-2 h-2 rounded-full ${STATUS_STYLE[status]?.dot ?? 'bg-zinc-600'}`} />

function Table({ cols, rows }) {
  if (!rows?.length) return null
  return (
    <table className="w-full text-xs selectable">
      <thead>
        <tr className="text-zinc-500 text-left">
          {cols.map((c) => <th key={c.label} className="font-normal pb-1.5 pr-2">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-zinc-800/80 align-top">
            {cols.map((c) => <td key={c.label} className="py-1.5 pr-2">{c.render(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const repoShortcuts = (path) => [
  { kind: 'openPath', label: 'Folder', path },
  { kind: 'openInCode', label: 'Code', path },
  { kind: 'openTerminal', label: 'Terminal', path }
]

function Devices() {
  const [devices, setDevices] = useState([])
  useEffect(() => { window.mc.getDevices().then(setDevices) }, [])
  const save = async (d, patch) => setDevices(await window.mc.setDevice(d.mac, { name: d.name, known: d.known, ...patch }))
  const unknown = devices.filter((d) => !d.known).length
  return (
    <div>
      <div className="flex items-center mb-2">
        <span className="text-xs text-zinc-400">{devices.length} devices seen · {unknown} not marked known</span>
        {unknown > 0 && (
          <button onClick={async () => setDevices(await window.mc.markAllKnown())}
            className="ml-auto text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700">Mark all known</button>
        )}
      </div>
      <Table rows={devices} cols={[
        { label: '', render: (d) => <input type="checkbox" checked={d.known} onChange={(e) => save(d, { known: e.target.checked })} title="Known device" /> },
        {
          label: 'Name', render: (d) => (
            <input defaultValue={d.name ?? ''} placeholder={d.vendor}
              onBlur={(e) => e.target.value !== (d.name ?? '') && save(d, { name: e.target.value })}
              className="bg-transparent border-b border-zinc-800 focus:border-sky-500 outline-none w-32 placeholder:text-zinc-600" />
          )
        },
        { label: 'IP', render: (d) => d.ip },
        { label: 'Vendor', render: (d) => <span className="text-zinc-400">{d.vendor}</span> },
        { label: 'Last seen', render: (d) => <span className="text-zinc-400">{ago(d.lastSeen)}</span> }
      ]} />
    </div>
  )
}

function Details({ result }) {
  const d = result.details ?? {}
  const id = result.id

  if (d.repos) {
    return <Table rows={d.repos} cols={[
      { label: 'Repo', render: (r) => r.name },
      { label: 'Issue', render: (r) => <span className="text-zinc-300">{r.info}</span> },
      { label: '', render: (r) => <Shortcuts shortcuts={repoShortcuts(r.path)} /> }
    ]} />
  }
  if (d.audits) {
    return <Table rows={d.audits} cols={[
      { label: '', render: (r) => <Dot status={r.status} /> },
      { label: 'Project', render: (r) => r.name },
      { label: 'Critical', render: (r) => r.critical },
      { label: 'High', render: (r) => r.high },
      { label: 'Moderate', render: (r) => r.moderate },
      { label: 'Low', render: (r) => r.low }
    ]} />
  }
  if (d.tokens) {
    return <Table rows={d.tokens} cols={[
      { label: '', render: (r) => <Dot status={r.status} /> },
      { label: 'File', render: (r) => r.file },
      { label: 'Days left', render: (r) => (r.missing ? 'no refresh token' : `${r.daysLeft}${r.baseline ? ' (at most)' : ''}`) },
      { label: 'Since', render: (r) => fmtTime(r.since) }
    ]} />
  }
  if (d.drives) {
    return (
      <div className="space-y-3">
        <Table rows={d.drives} cols={[
          { label: '', render: (r) => <Dot status={r.status} /> },
          { label: 'Drive', render: (r) => r.drive },
          { label: 'Free', render: (r) => `${r.freeGb} / ${r.sizeGb} GB` },
          { label: '%', render: (r) => `${r.freePct}%` }
        ]} />
        <Table rows={d.health} cols={[
          { label: '', render: (r) => <Dot status={r.status} /> },
          { label: 'Physical disk', render: (r) => r.name },
          { label: 'Health', render: (r) => r.health }
        ]} />
      </div>
    )
  }
  if (d.sites) {
    return <Table rows={d.sites} cols={[
      { label: '', render: (r) => <Dot status={r.status} /> },
      { label: 'Site', render: (r) => r.name },
      { label: 'HTTP', render: (r) => r.httpStatus || r.error },
      { label: 'ms', render: (r) => r.ms },
      { label: '', render: (r) => <Shortcuts shortcuts={[{ kind: 'openUrl', label: 'Open', url: r.url }]} /> }
    ]} />
  }
  if (d.projects && id === 'cloud.vercel') {
    return <Table rows={d.projects} cols={[
      { label: '', render: (r) => <Dot status={r.status} /> },
      { label: 'Project', render: (r) => r.name },
      { label: 'Deploy', render: (r) => r.state },
      { label: 'When', render: (r) => ago(r.created) },
      { label: '', render: (r) => <Shortcuts shortcuts={[{ kind: 'openUrl', label: 'Vercel', url: r.dashboard }]} /> }
    ]} />
  }
  if (d.projects && id === 'cloud.supabase') {
    return <Table rows={d.projects} cols={[
      { label: '', render: (r) => <Dot status={r.status} /> },
      { label: 'Project', render: (r) => r.name },
      { label: 'State', render: (r) => r.projectStatus },
      { label: 'DB size', render: (r) => (r.sizeMb == null ? '—' : `${r.sizeMb} MB (${r.pct}%)`) },
      { label: '', render: (r) => <Shortcuts shortcuts={[{ kind: 'openUrl', label: 'Dashboard', url: r.dashboard }]} /> }
    ]} />
  }
  if (d.keys) {
    return <Table rows={d.keys} cols={[
      { label: '', render: (r) => <Dot status={r.status} /> },
      { label: 'API', render: (r) => r.name },
      { label: 'HTTP', render: (r) => r.httpStatus },
      { label: 'Quota', render: (r) => (r.quota ? `${r.quota.remaining}/${r.quota.limit} (${r.quota.pct}%)` : '—') }
    ]} />
  }
  if (d.outages) {
    const rows = d.outages.filter((o) => o.end)
    return rows.length
      ? <Table rows={rows} cols={[
        { label: 'Outage start', render: (o) => fmtTime(o.start) },
        { label: 'Duration', render: (o) => `${Math.max(1, Math.round(o.durationMs / 60_000))} min` }
      ]} />
      : <p className="text-xs text-zinc-500">No outages recorded.</p>
  }
  if (id === 'net.devices') return <Devices />
  if (d.line) return <pre className="text-xs text-red-300 whitespace-pre-wrap selectable">{d.line}</pre>
  if (Object.keys(d).length === 0) return null
  return <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap selectable">{JSON.stringify(d, null, 2)}</pre>
}

export default function DetailPanel({ result, alert, onClose, onChanged }) {
  const [range, setRange] = useState(DAY)
  const [series, setSeries] = useState([])
  const s = STATUS_STYLE[result.status]

  useEffect(() => {
    window.mc.getMetrics(result.id, range).then(setSeries)
  }, [result.id, result.checkedAt, range])

  const mute = async (mode) => { await window.mc.mute(result.id, mode); onChanged() }
  const muteValue = alert?.muteUntilRecover ? 'recover' : isMuted(alert) ? 'day' : 'off'

  return (
    <aside className="w-[420px] shrink-0 border-l border-zinc-800 bg-[#0d1017] overflow-y-auto">
      <div className="p-5 space-y-5">
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 w-2.5 h-2.5 rounded-full ${s.dot}`} />
          <div className="flex-1">
            <h3 className="font-semibold">{result.title}</h3>
            <p className={`text-sm mt-0.5 ${result.status === 'ok' ? 'text-zinc-300' : s.text} selectable`}>{result.summary}</p>
            <p className="text-[11px] text-zinc-500 mt-1">{s.label} · checked {ago(result.checkedAt)} · <span className="font-mono">{result.id}</span></p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none">×</button>
        </div>

        {result.error && <p className="text-xs text-red-300 bg-red-950/40 rounded p-2 selectable">{result.error}</p>}
        {result.shortcuts?.length > 0 && <Shortcuts shortcuts={result.shortcuts} />}

        {result.status !== 'ok' && <FixGuide result={result} />}

        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-400">Alerts</span>
          <select value={muteValue} onChange={(e) => mute(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1">
            <option value="off">On</option>
            <option value="day">Muted for 1 day</option>
            <option value="recover">Muted until it recovers</option>
          </select>
        </div>

        {series.length > 0 && (
          <div className="space-y-4">
            <div className="flex gap-1 text-[11px]">
              {[['24h', DAY], ['7d', 7 * DAY], ['30d', 30 * DAY]].map(([label, ms]) => (
                <button key={label} onClick={() => setRange(ms)}
                  className={`px-2 py-0.5 rounded ${range === ms ? 'bg-zinc-700' : 'bg-zinc-900 text-zinc-400'}`}>{label}</button>
              ))}
            </div>
            {series.map((m) => <LineChart key={m.name} name={m.name} points={m.points} />)}
          </div>
        )}

        <Details result={result} />
      </div>
    </aside>
  )
}
