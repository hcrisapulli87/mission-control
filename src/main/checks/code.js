import { join } from 'path'
import { result, unknown } from '../status.js'

const DAY = 86_400_000
const FETCH_EVERY = 6 * 3_600_000

export const parsePorcelain = (text) => text.split(/\r?\n/).filter((l) => l.trim()).length

/** Lines from: git for-each-ref --format=%(refname:short)|%(committerdate:unix)|%(upstream:short)|%(upstream:track) */
export function parseRefs(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const [name, ts, upstream, track = ''] = l.split('|')
    const ahead = /ahead (\d+)/.exec(track)
    return {
      name, ts: Number(ts) * 1000, upstream: upstream || null,
      ahead: ahead ? Number(ahead[1]) : 0, gone: track.includes('gone')
    }
  })
}

export function isProject({ name, files }, ignore) {
  if (ignore.includes(name)) return false
  return files.some((f) => f === '.git' || f === 'package.json' || f.endsWith('.py'))
}

/** Every concern for one repo. Merged branches never count as unpushed or unmerged. */
export function evaluateRepo(repo, now, staleDays) {
  if (!repo.git) return { name: repo.name, nogit: true, dirty: 0, noremote: false, unpushed: [], unmerged: [], stale: [] }
  const merged = new Set(repo.merged)
  const unmerged = repo.branches.filter((b) => b.name !== repo.mainBranch && !merged.has(b.name))
  const unpushed = !repo.hasOrigin ? [] : repo.branches
    .filter((b) => b.ahead > 0 || (!b.upstream && !merged.has(b.name)))
    .map((b) => ({ branch: b.name, ahead: b.upstream ? b.ahead : null }))
  return {
    name: repo.name,
    nogit: false,
    dirty: repo.dirty,
    noremote: !repo.hasOrigin,
    unpushed,
    unmerged: unmerged.map((b) => b.name),
    stale: unmerged.filter((b) => now - b.ts > staleDays * DAY).map((b) => b.name)
  }
}

async function inspectRepo(ctx, name, path) {
  const git = (...args) => ctx.exec('git', ['-C', path, ...args])
  const remotes = (await git('remote')).stdout.split(/\r?\n/).map((s) => s.trim())
  const hasOrigin = remotes.includes('origin')

  if (hasOrigin) {
    const key = `fetch:${name}`
    if (ctx.now() - ctx.store.get(key, 0) > FETCH_EVERY) {
      await ctx.exec('git', ['-C', path, 'fetch', '--quiet', 'origin'], { timeoutMs: 20_000 })
      ctx.store.set(key, ctx.now())
    }
  }

  const branches = parseRefs((await git('for-each-ref',
    '--format=%(refname:short)|%(committerdate:unix)|%(upstream:short)|%(upstream:track)', 'refs/heads')).stdout)
  const mainBranch = branches.find((b) => b.name === 'main')?.name ?? branches.find((b) => b.name === 'master')?.name ?? null
  const merged = mainBranch
    ? (await git('branch', '--merged', mainBranch, '--format=%(refname:short)')).stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : []
  const dirty = parsePorcelain((await git('status', '--porcelain')).stdout)
  return { name, path, git: true, dirty, hasOrigin, mainBranch, merged, branches }
}

// All five code checks share one scan; memoised briefly so they don't each re-run git.
let memo = { at: 0, promise: null }
const MEMO_MS = 5 * 60_000

export function scanRepos(ctx) {
  if (memo.promise && ctx.now() - memo.at < MEMO_MS) return memo.promise
  memo = { at: ctx.now(), promise: doScan(ctx) }
  memo.promise.catch(() => { memo = { at: 0, promise: null } })
  return memo.promise
}
export const resetScanMemo = () => { memo = { at: 0, promise: null } }

async function doScan(ctx) {
  const { root } = ctx.settings.paths
  if (!ctx.fs.exists(root)) throw new Error(`Root folder not found: ${root}`)
  const out = []
  const rootFiles = (await ctx.fs.readdir(root)).map((e) => e.name)
  const candidates = [{ name: '(workspace)', path: root, files: rootFiles }]
  for (const e of await ctx.fs.readdir(root)) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const path = join(root, e.name)
    let files = []
    try { files = (await ctx.fs.readdir(path)).map((f) => f.name) } catch { continue }
    candidates.push({ name: e.name, path, files })
  }
  for (const c of candidates) {
    if (c.name !== '(workspace)' && !isProject(c, ctx.settings.ignore)) continue
    const info = c.files.includes('.git')
      ? await inspectRepo(ctx, c.name, c.path)
      : { name: c.name, path: c.path, git: false }
    out.push({ ...evaluateRepo(info, ctx.now(), ctx.settings.thresholds.staleBranchDays), path: c.path })
  }
  return out
}

const repoShortcuts = (r, extra = []) => [
  { kind: 'openPath', label: 'Folder', path: r.path },
  { kind: 'openInCode', label: 'VS Code', path: r.path },
  { kind: 'openTerminal', label: 'Terminal', path: r.path },
  ...extra
]

function codeCheck({ id, title, pick, describe, okText, extraShortcuts }) {
  return {
    id, area: 'code', title, intervalMs: 10 * 60_000, timeoutMs: 120_000,
    async run(ctx) {
      let repos
      try { repos = await scanRepos(ctx) } catch (err) { return unknown(err.message) }
      const hits = repos.filter(pick)
      if (!hits.length) return result('ok', okText, { details: { repos: [] } })
      const names = hits.map((r) => r.name)
      return result('warn', `${describe(hits)}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}`, {
        details: {
          repos: hits.map((r) => ({
            name: r.name, path: r.path, info: describeRepo(id, r),
            dirty: r.dirty, unpushed: r.unpushed, unmerged: r.unmerged, stale: r.stale
          }))
        },
        shortcuts: hits.length === 1 ? repoShortcuts(hits[0], extraShortcuts?.(hits[0]) ?? []) : []
      })
    }
  }
}

function describeRepo(id, r) {
  switch (id) {
    case 'code.nogit': return 'no git repo'
    case 'code.dirty': return `${r.dirty} changed file${r.dirty > 1 ? 's' : ''}`
    case 'code.noremote': return 'no origin remote'
    case 'code.unpushed': return r.unpushed.map((u) => (u.ahead == null ? `${u.branch} (never pushed)` : `${u.branch} +${u.ahead}`)).join(', ')
    case 'code.branches': return r.unmerged.map((b) => (r.stale.includes(b) ? `${b} (stale)` : b)).join(', ')
    default: return ''
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export const codeChecks = [
  codeCheck({
    id: 'code.nogit', title: 'Projects without git', pick: (r) => r.nogit,
    describe: (h) => plural(h.length, 'project', 'projects') + ' not under git', okText: 'Every project has a repo'
  }),
  codeCheck({
    id: 'code.dirty', title: 'Uncommitted changes', pick: (r) => r.dirty > 0,
    describe: (h) => plural(h.length, 'repo', 'repos') + ' with uncommitted changes', okText: 'All working trees clean'
  }),
  codeCheck({
    id: 'code.noremote', title: 'Repos without a remote', pick: (r) => !r.nogit && r.noremote,
    describe: (h) => plural(h.length, 'repo', 'repos') + ' with no origin', okText: 'Every repo has an origin'
  }),
  codeCheck({
    id: 'code.unpushed', title: 'Unpushed commits', pick: (r) => r.unpushed.length > 0,
    describe: (h) => plural(h.length, 'repo', 'repos') + ' with unpushed work', okText: 'Everything pushed',
    extraShortcuts: () => [{ kind: 'copy', label: 'Copy git push', text: 'git push' }]
  }),
  codeCheck({
    id: 'code.branches', title: 'Unmerged branches', pick: (r) => r.unmerged.length > 0,
    describe: (h) => plural(h.reduce((n, r) => n + r.unmerged.length, 0), 'unmerged branch', 'unmerged branches'),
    okText: 'No unmerged branches'
  })
]
