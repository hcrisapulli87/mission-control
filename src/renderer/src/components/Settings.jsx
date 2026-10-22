import { useEffect, useState } from 'react'

const SECRETS = [
  { key: 'vercelToken', label: 'Vercel token', help: 'vercel.com → Account Settings → Tokens' },
  { key: 'supabaseToken', label: 'Supabase access token', help: 'supabase.com/dashboard/account/tokens' },
  { key: 'tmdbKey', label: 'TMDB key' },
  { key: 'igdbClientId', label: 'IGDB client ID' },
  { key: 'igdbClientSecret', label: 'IGDB client secret' },
  { key: 'ebayClientId', label: 'eBay client (app) ID' },
  { key: 'ebayClientSecret', label: 'eBay client secret (cert ID)' },
  { key: 'pokemonTcgKey', label: 'Pokémon TCG key' },
  { key: 'steamGridDbKey', label: 'SteamGridDB key' },
  { key: 'steamKey', label: 'Steam Web API key' }
]

const THRESHOLDS = [
  ['botActivityWarnH', 'Bot quiet → warn (hours)'], ['botActivityFailH', 'Bot quiet → fail (hours)'],
  ['crashLoopExits', 'Crash loop: exits per hour'],
  ['staleBranchDays', 'Stale branch (days)'], ['gpuWarn', 'GPU warn (°C)'], ['gpuFail', 'GPU fail (°C)'],
  ['cpuWarn', 'CPU warn (%)'], ['ramWarn', 'RAM warn (%)'], ['sustainedSamples', 'Sustained minutes'],
  ['diskWarnPct', 'Disk free warn (%)'], ['diskFailPct', 'Disk free fail (%)'], ['uptimeWarnDays', 'Uptime warn (days)'],
  ['latencyWarnMs', 'Site slow (ms)'], ['supabaseWarnPct', 'Supabase DB warn (%)'], ['supabaseFailPct', 'Supabase DB fail (%)'],
  ['supabaseLimitMb', 'Supabase DB limit (MB)'], ['speedWarnRatio', 'Speed warn (× median)'], ['speedSkipGpuUtil', 'Skip speed test above GPU %']
]

const Section = ({ title, children, right }) => (
  <section className="rounded-xl bg-zinc-900/50 ring-1 ring-zinc-800">
    <header className="flex items-center px-5 h-11 border-b border-zinc-800">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
      <div className="ml-auto">{right}</div>
    </header>
    <div className="p-5 space-y-3">{children}</div>
  </section>
)

const input = 'bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-sm outline-none focus:border-sky-600'

function SecretField({ def, masked, onSaved }) {
  const [value, setValue] = useState('')
  const save = async (v) => { onSaved(await window.mc.setSecret(def.key, v)); setValue('') }
  return (
    <div className="grid grid-cols-[200px_1fr_auto] items-center gap-3">
      <div>
        <div className="text-sm">{def.label}</div>
        {def.help && <div className="text-[11px] text-zinc-500">{def.help}</div>}
      </div>
      <input type="password" value={value} onChange={(e) => setValue(e.target.value)}
        placeholder={masked ?? 'not set'} className={input} />
      <div className="flex gap-1.5">
        <button disabled={!value} onClick={() => save(value)} className="text-xs px-2.5 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40">Save</button>
        {masked && <button onClick={() => save('')} className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700">Clear</button>}
      </div>
    </div>
  )
}

function ImportKeys({ onImported }) {
  const [found, setFound] = useState(null)
  const [pick, setPick] = useState({})
  const [scanning, setScanning] = useState(false)
  const scan = async () => {
    setScanning(true)
    try {
      const f = await window.mc.scanKeys()
      setFound(f)
      setPick(Object.fromEntries(f.map((k) => [k.secret, !k.alreadySet])))
    } finally { setScanning(false) }
  }
  const doImport = async () => {
    onImported(await window.mc.importKeys(Object.keys(pick).filter((k) => pick[k])))
    setFound(null)
  }
  return (
    <div className="rounded-lg bg-zinc-950/60 ring-1 ring-zinc-800 p-3">
      <div className="flex items-center gap-3">
        <div className="text-sm flex-1">
          Import from apps
          <div className="text-[11px] text-zinc-500">Reads keys your other apps already hold (.env files, CineVault/GameVault/pokemon-portfolio settings, RetroHub config). Copied once, encrypted.</div>
        </div>
        <button onClick={scan} disabled={scanning} className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700">
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </div>
      {found && (
        <div className="mt-3 space-y-1.5">
          {found.length === 0 && <p className="text-xs text-zinc-500">No known keys found.</p>}
          {found.map((k) => (
            <label key={k.secret} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!pick[k.secret]} onChange={(e) => setPick({ ...pick, [k.secret]: e.target.checked })} />
              <span className="w-40">{SECRETS.find((s) => s.key === k.secret)?.label ?? k.secret}</span>
              <span className="font-mono text-zinc-400">{k.preview}</span>
              <span className="text-zinc-500">from {k.source}</span>
              {k.alreadySet && <span className="text-amber-500">(replaces current)</span>}
            </label>
          ))}
          {found.length > 0 && (
            <button onClick={doImport} className="mt-2 text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600">Import selected</button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const [state, setState] = useState(null)
  const [saved, setSaved] = useState(false)
  const load = async () => setState(await window.mc.getSettings())
  useEffect(() => { load() }, [])
  if (!state) return null
  const { settings, masked } = state

  const save = async (partial) => {
    await window.mc.setSettings(partial)
    await load()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-5 max-w-4xl">
      {saved && <div className="fixed top-16 right-6 text-xs bg-emerald-800 px-3 py-1.5 rounded">Saved</div>}

      <Section title="General">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={state.startWithWindows} onChange={(e) => save({ startWithWindows: e.target.checked })} />
          Start with Windows (tray only)
        </label>
        {[['root', 'Projects folder'], ['bot', 'Discord bot folder']].map(([k, label]) => (
          <div key={k} className="grid grid-cols-[200px_1fr] items-center gap-3">
            <span className="text-sm">{label}</span>
            <input defaultValue={settings.paths[k]} className={input}
              onBlur={(e) => e.target.value !== settings.paths[k] && save({ paths: { ...settings.paths, [k]: e.target.value } })} />
          </div>
        ))}
        <div className="grid grid-cols-[200px_1fr] items-center gap-3">
          <span className="text-sm">Ignored folders</span>
          <input defaultValue={settings.ignore.join(', ')} className={input}
            onBlur={(e) => save({ ignore: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </div>
        <div className="grid grid-cols-[200px_1fr] items-center gap-3">
          <span className="text-sm">Local-only repos (no GitHub)</span>
          <input defaultValue={(settings.localOnly ?? []).join(', ')} className={input}
            onBlur={(e) => save({ localOnly: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </div>
      </Section>

      <Section title="Connections">
        <ImportKeys onImported={(m) => setState({ ...state, masked: m })} />
        {SECRETS.map((def) => (
          <SecretField key={def.key} def={def} masked={masked[def.key]} onSaved={(m) => setState({ ...state, masked: m })} />
        ))}
        <div className="grid grid-cols-[200px_1fr] items-center gap-3">
          <div>
            <div className="text-sm">Vercel team ID</div>
            <div className="text-[11px] text-zinc-500">Only if projects live under a team</div>
          </div>
          <input defaultValue={settings.vercelTeamId} className={input} placeholder="team_…"
            onBlur={(e) => e.target.value !== settings.vercelTeamId && save({ vercelTeamId: e.target.value.trim() })} />
        </div>
        <p className="text-[11px] text-zinc-500">Secrets are encrypted with Windows DPAPI and never shown in full here.</p>
      </Section>

      <Section title="Thresholds" right={
        <button onClick={() => save({ thresholds: state.defaults.thresholds })} className="text-xs text-zinc-400 hover:text-white">Reset to defaults</button>
      }>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {THRESHOLDS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <span className="flex-1 text-zinc-300">{label}</span>
              <input type="number" step="any" defaultValue={settings.thresholds[k]} key={settings.thresholds[k]}
                className={`${input} w-24 text-right`}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v) && v !== settings.thresholds[k]) save({ thresholds: { ...settings.thresholds, [k]: v } })
                }} />
            </label>
          ))}
        </div>
      </Section>
    </main>
  )
}
