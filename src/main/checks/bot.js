import { join } from 'path'
import { result, unknown } from '../status.js'
import { fmtDuration } from '../format.js'

const H = 3_600_000

export function parseTasklist(csv) {
  return csv.split(/\r?\n/).filter((l) => /^"pythonw\.exe"/i.test(l)).length
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

const AUTH = /invalid_grant|RefreshError|_authenticate/

/** Auth error text from the most recent bot start, if that start is recent. */
export function findAuthError(text, now, windowMs) {
  const ls = lines(text)
  let start = -1
  for (let i = ls.length - 1; i >= 0; i--) if (ls[i].includes('starting bot')) { start = i; break }
  if (start < 0) return null
  const t = parseLogTime(ls[start])
  if (t == null || t < now - windowMs) return null
  const hit = ls.slice(start + 1).find((l) => AUTH.test(l))
  return hit ? hit.trim() : null
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
      const { stdout } = await ctx.exec('tasklist', ['/FI', 'IMAGENAME eq pythonw.exe', '/FO', 'CSV', '/NH'])
      const n = parseTasklist(stdout)
      return n > 0
        ? result('ok', `Running (${n} pythonw process${n > 1 ? 'es' : ''})`, { details: { processes: n } })
        : result('fail', 'Bot is not running', { details: { processes: 0 }, shortcuts: botShortcuts(bot) })
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
    id: 'bot.auth', area: 'bot', title: 'Bot Google auth', intervalMs: 5 * 60_000,
    async run(ctx) {
      const bot = ctx.settings.paths.bot
      const text = await tail(ctx, join(bot, 'logs', 'launcher.log'), 256 * 1024)
      if (text == null) return unknown('launcher.log not found')
      const hit = findAuthError(text, ctx.now(), H)
      return hit
        ? result('fail', 'Google token dead — re-auth the bot', { details: { line: hit }, shortcuts: botShortcuts(bot) })
        : result('ok', 'No auth errors since last start')
    }
  }
]
