import { join } from 'path'
import { result, unknown } from '../status.js'
import { fmtDuration } from '../format.js'

const H = 3_600_000

// Other apps (Ambience) also run under pythonw, so match on the command line, not the image name.
const BOT_PROCS_PS = "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"

// A venv launch is two processes (Scripts\pythonw.exe stub -> base interpreter child): a bot
// process whose parent is also a bot process belongs to the same instance.
export function parseBotProcesses(json) {
  let list
  try { list = JSON.parse(json || '[]') } catch { return { processes: 0, instances: 0 } }
  if (!Array.isArray(list)) list = [list]
  const bots = list.filter((p) => p && /\bbot\.py\b/i.test(p.CommandLine ?? ''))
  const ids = new Set(bots.map((p) => p.ProcessId))
  return { processes: bots.length, instances: bots.filter((p) => !ids.has(p.ParentProcessId)).length }
}

// Three timestamp styles appear in the bot's logs:
//   bot.log           2026-09-29 19:01:10,001 [INFO] ...
//   discord in launcher [2026-09-14 12:08:36] [INFO    ] ...
//   start_bot.bat     [Tue 29/09/2026 21:13:43.84] starting bot   (AU dd/mm/yyyy)
const ISO = /^\[?(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/
const AU = /^\[\w{3} (\d{2})\/(\d{2})\/(\d{4}) +(\d{1,2}):(\d{2}):(\d{2})\.(\d{2})\]/

export function parseLogTime(line) {
  let m = ISO.exec(line)
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  m = AU.exec(line)
  if (m) return new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime() + m[7] * 10
  return null
}

const lines = (text) => text.split(/\r?\n/)

export function lastLogTime(text) {
  const ls = lines(text)
  for (let i = ls.length - 1; i >= 0; i--) {
    const t = parseLogTime(ls[i])
    if (t != null) return t
  }
  return null
}

export function countExits(text, now, windowMs) {
  return lines(text).filter((l) => {
    if (!l.includes('bot exited')) return false
    const t = parseLogTime(l)
    return t != null && t >= now - windowMs && t <= now
  }).length
}

// ---------- Startup entry ----------
// Windows keeps each Startup-folder item's on/off switch (Task Manager → Startup apps)
// in this key: byte 0 odd = disabled, bytes 4-11 = FILETIME of the last toggle.
// No value at all means the item was never toggled, i.e. enabled.
const STARTUP_APPROVED = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'
const FILETIME_EPOCH_MS = 11_644_473_600_000n

/** `reg query <key>` output → { [valueName]: { enabled, changedAt } }. */
export function parseStartupApproved(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s{2,}(.+?)\s+REG_BINARY\s+([0-9A-F]+)\s*$/i.exec(line)
    if (!m) continue
    const bytes = Buffer.from(m[2], 'hex')
    let changedAt = null
    if (bytes.length >= 12) {
      const ft = bytes.readBigUInt64LE(4)
      if (ft > 0n) changedAt = Number(ft / 10_000n - FILETIME_EPOCH_MS)
    }
    out[m[1]] = { enabled: (bytes[0] & 1) === 0, changedAt }
  }
  return out
}

/**
 * Which Startup-folder files launch the bot: their contents mention the bot folder.
 * `files` = [{ name, text }] (.lnk targets are stored as UTF-16, so callers pass both decodings).
 */
export function findBotStartupEntries(files, botPath) {
  const needle = botPath.toLowerCase().replace(/[\\/]+$/, '')
  return files.filter((f) => /\.(vbs|bat|cmd|lnk)$/i.test(f.name) && f.text.toLowerCase().includes(needle)).map((f) => f.name)
}

/** Verdict for the bot's startup entries given their on/off state. */
export function startupVerdict(entries, approved) {
  if (!entries.length) return { status: 'fail', reason: 'missing' }
  const states = entries.map((name) => ({ name, ...(approved[name] ?? { enabled: true, changedAt: null }) }))
  const on = states.find((s) => s.enabled)
  if (on) return { status: 'ok', entry: on }
  return { status: 'fail', reason: 'disabled', entry: states.sort((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0))[0] }
}

export function activityVerdict(lastTs, now, t) {
  if (lastTs == null) return 'unknown'
  const age = now - lastTs
  if (age > t.botActivityFailH * H) return 'fail'
  if (age > t.botActivityWarnH * H) return 'warn'
  return 'ok'
}

const botShortcuts = (bot) => [
  { kind: 'openPath', label: 'Open folder', path: bot },
  { kind: 'openPath', label: 'Open launcher.log', path: join(bot, 'logs', 'launcher.log') },
  { kind: 'copy', label: 'Copy start command', text: `wscript "${join(bot, 'launch_hidden.vbs')}"` }
]

async function tail(ctx, path, bytes) {
  return ctx.fs.exists(path) ? ctx.fs.readTail(path, bytes) : null
}

export const botChecks = [
  {
    id: 'bot.process', area: 'bot', title: 'Bot process', intervalMs: 60_000,
    async run(ctx) {
      const bot = ctx.settings.paths.bot
      const { processes, instances } = parseBotProcesses((await ctx.powershell(BOT_PROCS_PS)).stdout)
      if (instances === 0) return result('fail', 'Bot is not running', { details: { processes, instances }, shortcuts: botShortcuts(bot) })
      return instances === 1
        ? result('ok', 'Running', { details: { processes, instances } })
        : result('warn', `${instances} bot instances running — messages may be answered twice`, { details: { processes, instances }, shortcuts: botShortcuts(bot) })
    }
  },
  {
    id: 'bot.activity', area: 'bot', title: 'Bot activity', intervalMs: 5 * 60_000,
    async run(ctx) {
      const bot = ctx.settings.paths.bot
      const texts = await Promise.all([
        tail(ctx, join(bot, 'logs', 'bot.log'), 64 * 1024),
        tail(ctx, join(bot, 'logs', 'launcher.log'), 64 * 1024)
      ])
      if (texts.every((t) => t == null)) return unknown(`No logs found in ${bot}\logs`)
      const times = texts.filter(Boolean).map(lastLogTime).filter((t) => t != null)
      const last = times.length ? Math.max(...times) : null
      const now = ctx.now()
      const status = activityVerdict(last, now, ctx.settings.thresholds)
      const summary = last == null ? 'No timestamped log lines' : `Last log line ${fmtDuration(now - last)} ago`
      return result(status, summary, { details: { lastLogAt: last }, shortcuts: status === 'ok' ? [] : botShortcuts(bot) })
    }
  },
  {
    id: 'bot.crashloop', area: 'bot', title: 'Bot restarts', intervalMs: 5 * 60_000,
    async run(ctx) {
      const bot = ctx.settings.paths.bot
      const text = await tail(ctx, join(bot, 'logs', 'launcher.log'), 256 * 1024)
      if (text == null) return unknown('launcher.log not found')
      const n = countExits(text, ctx.now(), H)
      const limit = ctx.settings.thresholds.crashLoopExits
      return n > limit
        ? result('fail', `Crash loop: ${n} exits in the last hour`, { details: { exitsLastHour: n }, shortcuts: botShortcuts(bot) })
        : result('ok', n ? `${n} restart${n > 1 ? 's' : ''} in the last hour` : 'No restarts in the last hour', { details: { exitsLastHour: n } })
    }
  },
  {
    // Caught too late on 2026-09-29: the entry was switched off and the bot silently
    // stayed down for three weeks of reboots. This turns that into a same-day alert.
    id: 'bot.startup', area: 'bot', title: 'Bot starts with Windows', intervalMs: 15 * 60_000,
    async run(ctx) {
      const bot = ctx.settings.paths.bot
      const startupDir = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
      if (!ctx.fs.exists(startupDir)) return unknown('Startup folder not found')
      const files = []
      for (const e of await ctx.fs.readdir(startupDir)) {
        if (!e.isFile() || !/\.(vbs|bat|cmd|lnk)$/i.test(e.name)) continue
        const buf = await ctx.fs.readBuffer(join(startupDir, e.name))
        files.push({ name: e.name, text: buf.toString('latin1') + buf.toString('utf16le') })
      }
      const entries = findBotStartupEntries(files, bot)
      const approved = parseStartupApproved((await ctx.exec('reg', ['query', STARTUP_APPROVED])).stdout)
      const v = startupVerdict(entries, approved)
      const details = { startupDir, entries, entry: v.entry ?? null }
      const shortcuts = [{ kind: 'openPath', label: 'Open Startup folder', path: startupDir }]
      if (v.status === 'ok') return result('ok', `Enabled (${v.entry.name})`, { details })
      if (v.reason === 'missing') {
        return result('fail', 'No Startup entry launches the bot — it won\'t start after a reboot', { details, shortcuts })
      }
      const when = v.entry.changedAt ? ` on ${new Date(v.entry.changedAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''
      return result('fail', `Startup entry switched off${when} — bot won't start after a reboot`, { details, shortcuts })
    }
  }
]
