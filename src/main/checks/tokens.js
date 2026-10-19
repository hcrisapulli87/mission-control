import { createHash } from 'crypto'
import { join } from 'path'
import { result, unknown, worst } from '../status.js'
import { fmtDate } from '../format.js'

const DAY = 86_400_000
const LIFETIME_DAYS = 7 // Google refresh tokens for OAuth apps in "Testing" mode

/**
 * The token file's `expiry` is the 1-hour access token, useless here. Instead we
 * remember when each refresh_token (hashed — never stored) was first seen; a new
 * hash means a fresh sign-in, so the 7-day clock restarts.
 */
export function tokenCountdown({ stored, hash, now, warnDays, testingMode }) {
  if (!hash) return { status: 'fail', daysLeft: 0, newStored: stored, missing: true }
  let rec = stored
  if (!rec || rec.hash !== hash) rec = { hash, firstSeen: now, baseline: !stored }
  const daysLeft = Math.max(0, Math.round((LIFETIME_DAYS - (now - rec.firstSeen) / DAY) * 10) / 10)
  let status = 'ok'
  if (testingMode) status = daysLeft <= 0 ? 'fail' : daysLeft <= warnDays ? 'warn' : 'ok'
  return { status, daysLeft, newStored: rec, baseline: !!rec.baseline }
}

const sha = (s) => createHash('sha256').update(s).digest('hex')

export const tokenChecks = [
  {
    id: 'google.tokens', area: 'bot', title: 'Google tokens', intervalMs: 15 * 60_000,
    async run(ctx) {
      const bot = ctx.settings.paths.bot
      if (!ctx.fs.exists(bot)) return unknown(`Bot folder not found: ${bot}`)
      const files = (await ctx.fs.readdir(bot)).map((e) => e.name).filter((n) => /^token_.*\.json$/.test(n))
      if (!files.length) return unknown('No token_*.json files')

      const rows = []
      for (const name of files) {
        let refresh = null
        try { refresh = JSON.parse(await ctx.fs.readFile(join(bot, name))).refresh_token ?? null } catch { /* unreadable */ }
        const stored = ctx.db.getTokenHash(name)
        const storedRec = stored && { ...stored, baseline: ctx.store.get(`baseline:${name}`, false) }
        const r = tokenCountdown({
          stored: storedRec, hash: refresh && sha(refresh), now: ctx.now(),
          warnDays: ctx.settings.thresholds.tokenWarnDays, testingMode: ctx.settings.oauthTesting
        })
        if (r.newStored && (!stored || stored.hash !== r.newStored.hash)) {
          ctx.db.setTokenHash(name, r.newStored.hash, r.newStored.firstSeen)
          ctx.store.set(`baseline:${name}`, r.newStored.baseline)
        }
        rows.push({
          file: name, status: r.status, daysLeft: r.daysLeft, missing: !!r.missing,
          since: r.newStored?.firstSeen ?? null, baseline: r.baseline
        })
      }

      const status = worst(rows.map((r) => r.status))
      const soonest = rows.filter((r) => !r.missing).sort((a, b) => a.daysLeft - b.daysLeft)[0]
      let summary
      if (!ctx.settings.oauthTesting) summary = 'OAuth app published — tokens do not expire'
      else if (rows.some((r) => r.missing)) summary = 'A token file has no refresh token — re-auth needed'
      else if (status === 'fail') summary = 'Token expired — re-auth the bot'
      else summary = `${soonest.file.replace(/^token_|\.json$/g, '')}: ${soonest.daysLeft}d left` +
        (soonest.baseline ? ` (age unknown before ${fmtDate(soonest.since)})` : '')

      return result(status, summary, {
        details: { tokens: rows },
        shortcuts: status === 'ok' ? [] : [{ kind: 'openPath', label: 'Open bot folder', path: bot }]
      })
    }
  }
]
