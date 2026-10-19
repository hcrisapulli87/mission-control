import { join } from 'path'
import { result, unknown, worst } from '../status.js'
import { scanRepos } from './code.js'

export function parseAudit(text) {
  try {
    const v = JSON.parse(text)?.metadata?.vulnerabilities
    if (!v) return null
    return { low: v.low ?? 0, moderate: v.moderate ?? 0, high: v.high ?? 0, critical: v.critical ?? 0 }
  } catch {
    return null
  }
}

export function auditVerdict(c) {
  if (c.high + c.critical > 0) return 'fail'
  if (c.moderate > 0) return 'warn'
  return 'ok'
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

export const auditChecks = [
  {
    id: 'code.audit', area: 'code', title: 'npm audit', intervalMs: 24 * 3_600_000, timeoutMs: 600_000,
    async run(ctx) {
      let repos
      try { repos = await scanRepos(ctx) } catch (err) { return unknown(err.message) }
      const rows = []
      for (const r of repos) {
        if (r.name === '(workspace)' || !ctx.fs.exists(join(r.path, 'package-lock.json'))) continue
        // npm.cmd needs a shell on Windows; args are fixed strings, nothing user-supplied.
        const { stdout } = await ctx.exec(npm, ['audit', '--json', '--omit=dev'], { cwd: r.path, timeoutMs: 90_000, shell: true })
        const counts = parseAudit(stdout)
        if (counts) rows.push({ name: r.name, path: r.path, ...counts, status: auditVerdict(counts) })
      }
      if (!rows.length) return unknown('npm audit produced no results')
      const status = worst(rows.map((r) => r.status))
      const bad = rows.filter((r) => r.status !== 'ok')
      const summary = bad.length
        ? bad.map((r) => `${r.name} (${r.critical + r.high} high, ${r.moderate} mod)`).slice(0, 3).join(', ')
        : `${rows.length} projects, no moderate+ vulnerabilities`
      return result(status, summary, {
        details: { audits: rows },
        shortcuts: bad.length === 1 ? [{ kind: 'openTerminal', label: 'Terminal', path: bad[0].path }, { kind: 'copy', label: 'Copy npm audit fix', text: 'npm audit fix' }] : []
      })
    }
  }
]
