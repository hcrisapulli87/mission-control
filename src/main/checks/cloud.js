import { result, unknown, worst } from '../status.js'

const MIN = 60_000
const NOT_CONFIGURED = (what) => unknown(`Not configured — add ${what} in Settings`)

// ---------- Vercel ----------

export function evalDeployment(d, now) {
  if (!d) return 'unknown'
  const state = d.state ?? d.readyState
  if (state === 'READY') return 'ok'
  if (state === 'ERROR' || state === 'CANCELED') return 'fail'
  if ((state === 'BUILDING' || state === 'QUEUED' || state === 'INITIALIZING') && now - d.created > 30 * MIN) return 'warn'
  return 'ok'
}

const vercelHeaders = (token) => ({ Authorization: `Bearer ${token}` })
const withTeam = (url, teamId) => (teamId ? `${url}${url.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}` : url)

async function vercelProjects(ctx) {
  const token = ctx.settings.secret('vercelToken')
  if (!token) return null
  const team = ctx.settings.vercelTeamId
  const res = await ctx.http(withTeam('https://api.vercel.com/v9/projects?limit=100', team), { headers: vercelHeaders(token) })
  if (!res.ok) return { error: res.error ?? `Vercel API ${res.status}`, networkError: res.status === 0 }
  const out = []
  for (const p of res.json?.projects ?? []) {
    const [dep, doms] = await Promise.all([
      ctx.http(withTeam(`https://api.vercel.com/v6/deployments?projectId=${p.id}&target=production&limit=1`, team), { headers: vercelHeaders(token) }),
      ctx.http(withTeam(`https://api.vercel.com/v9/projects/${p.id}/domains`, team), { headers: vercelHeaders(token) })
    ])
    const deployment = dep.json?.deployments?.[0] ?? null
    const domain = doms.json?.domains?.find((d) => !d.redirect)?.name ?? (deployment?.url || null)
    out.push({ id: p.id, name: p.name, deployment, url: domain ? `https://${domain}` : null })
  }
  return { projects: out }
}

// ---------- Uptime ----------

export function uptimeVerdict(res, latencyWarnMs) {
  if (!res.status || res.status >= 400) return 'fail'
  return res.ms > latencyWarnMs ? 'warn' : 'ok'
}

// ---------- Supabase ----------

export function evalSupabase(project, sizeBytes, t) {
  if (project.status !== 'ACTIVE_HEALTHY') return { status: 'fail', pct: null }
  if (sizeBytes == null) return { status: 'ok', pct: null }
  const pct = Math.round((sizeBytes / (t.supabaseLimitMb * 2 ** 20)) * 100)
  const status = pct >= t.supabaseFailPct ? 'fail' : pct >= t.supabaseWarnPct ? 'warn' : 'ok'
  return { status, pct }
}

// ---------- API keys ----------

const keyVerdict = (res) => (res.status === 0 ? 'unknown' : res.status === 401 || res.status === 403 ? 'fail' : res.status < 400 ? 'ok' : 'unknown')

export function ebayQuota(json) {
  const rates = (json?.rateLimits ?? []).flatMap((a) => a.resources ?? []).flatMap((r) => r.rates ?? [])
    .filter((r) => r.limit > 0)
  if (!rates.length) return null
  const low = rates.sort((a, b) => a.remaining / a.limit - b.remaining / b.limit)[0]
  return { remaining: low.remaining, limit: low.limit, pct: Math.round((low.remaining / low.limit) * 100) }
}

export const API_TESTERS = [
  {
    name: 'TMDB', secrets: ['tmdbKey'],
    request: ({ tmdbKey }) => (tmdbKey.startsWith('eyJ')
      ? { url: 'https://api.themoviedb.org/3/configuration', headers: { Authorization: `Bearer ${tmdbKey}` } }
      : { url: `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(tmdbKey)}`, headers: {} }),
    verdict: keyVerdict
  },
  {
    name: 'IGDB (Twitch)', secrets: ['igdbClientId', 'igdbClientSecret'],
    request: ({ igdbClientId, igdbClientSecret }) => ({
      url: `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(igdbClientId)}&client_secret=${encodeURIComponent(igdbClientSecret)}&grant_type=client_credentials`,
      method: 'POST', headers: {}
    }),
    verdict: (res) => (res.status === 400 ? 'fail' : keyVerdict(res))
  },
  {
    name: 'Pokémon TCG', secrets: ['pokemonTcgKey'],
    request: ({ pokemonTcgKey }) => ({ url: 'https://api.pokemontcg.io/v2/sets?pageSize=1', headers: { 'X-Api-Key': pokemonTcgKey } }),
    verdict: keyVerdict
  },
  {
    name: 'SteamGridDB', secrets: ['steamGridDbKey'],
    request: ({ steamGridDbKey }) => ({ url: 'https://www.steamgriddb.com/api/v2/search/autocomplete/zelda', headers: { Authorization: `Bearer ${steamGridDbKey}` } }),
    verdict: keyVerdict
  },
  {
    name: 'Steam Web API', secrets: ['steamKey'],
    request: ({ steamKey }) => ({ url: `https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/?key=${encodeURIComponent(steamKey)}`, headers: {} }),
    verdict: keyVerdict
  },
  {
    name: 'eBay', secrets: ['ebayClientId', 'ebayClientSecret'],
    request: ({ ebayClientId, ebayClientSecret }) => ({
      url: 'https://api.ebay.com/identity/v1/oauth2/token', method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${ebayClientId}:${ebayClientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
    }),
    verdict: (res) => (res.status === 400 ? 'fail' : keyVerdict(res)),
    // eBay is the one API that reports remaining quota.
    async extra(ctx, res) {
      const token = res.json?.access_token
      if (!token) return null
      const q = await ctx.http('https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_name=browse',
        { headers: { Authorization: `Bearer ${token}` } })
      return q.ok ? ebayQuota(q.json) : null
    }
  }
]

// ---------- Checks ----------

export const cloudChecks = [
  {
    id: 'cloud.vercel', area: 'cloud', title: 'Vercel deploys', intervalMs: 10 * MIN, timeoutMs: 60_000,
    async run(ctx) {
      const r = await vercelProjects(ctx)
      if (!r) return NOT_CONFIGURED('a Vercel token')
      if (r.error) return unknown(r.error, { networkError: r.networkError })
      ctx.store.set('sites', r.projects.filter((p) => p.url).map((p) => ({ name: p.name, url: p.url })))
      const now = ctx.now()
      const rows = r.projects.map((p) => ({
        name: p.name, url: p.url, state: p.deployment?.state ?? p.deployment?.readyState ?? 'NONE',
        created: p.deployment?.created ?? null, status: evalDeployment(p.deployment, now),
        dashboard: p.deployment?.inspectorUrl || 'https://vercel.com/dashboard'
      }))
      const status = worst(rows.map((x) => x.status))
      const bad = rows.filter((x) => x.status === 'fail' || x.status === 'warn')
      return result(status, bad.length ? bad.map((x) => `${x.name}: ${x.state}`).join(', ') : `${rows.length} projects, all production deploys ready`, {
        details: { projects: rows },
        shortcuts: bad.length === 1 ? [{ kind: 'openUrl', label: 'Open in Vercel', url: bad[0].dashboard }] : [{ kind: 'openUrl', label: 'Vercel dashboard', url: 'https://vercel.com/dashboard' }]
      })
    }
  },
  {
    id: 'cloud.uptime', area: 'cloud', title: 'Sites up', intervalMs: 5 * MIN, timeoutMs: 60_000,
    async run(ctx) {
      const sites = ctx.db.kvGet('check:cloud.vercel:sites', null)
      if (!sites) return ctx.settings.secret('vercelToken') ? unknown('Waiting for Vercel project list…') : NOT_CONFIGURED('a Vercel token')
      const t = ctx.settings.thresholds
      const rows = await Promise.all(sites.map(async (s) => {
        const res = await ctx.http(s.url, { timeoutMs: 10_000 })
        return { ...s, httpStatus: res.status, ms: res.ms, error: res.error ?? null, status: uptimeVerdict(res, t.latencyWarnMs) }
      }))
      const down = rows.filter((x) => x.status === 'fail')
      const slow = rows.filter((x) => x.status === 'warn')
      const metrics = Object.fromEntries(rows.filter((x) => x.httpStatus).map((x) => [`ms_${x.name}`, x.ms]))
      const summary = down.length ? `Down: ${down.map((x) => x.name).join(', ')}`
        : slow.length ? `Slow: ${slow.map((x) => `${x.name} ${x.ms}ms`).join(', ')}`
          : `${rows.length} sites up`
      return result(worst(rows.map((x) => x.status)), summary, {
        details: { sites: rows }, metrics,
        shortcuts: down.length === 1 ? [{ kind: 'openUrl', label: 'Open site', url: down[0].url }] : []
      })
    }
  },
  {
    id: 'cloud.supabase', area: 'cloud', title: 'Supabase', intervalMs: 15 * MIN, timeoutMs: 60_000,
    async run(ctx) {
      const token = ctx.settings.secret('supabaseToken')
      if (!token) return NOT_CONFIGURED('a Supabase access token')
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      const res = await ctx.http('https://api.supabase.com/v1/projects', { headers })
      if (!res.ok) return unknown(res.error ?? `Supabase API ${res.status}`, { networkError: res.status === 0 })
      const t = ctx.settings.thresholds
      const rows = []
      for (const p of res.json ?? []) {
        let size = null
        if (p.status === 'ACTIVE_HEALTHY') {
          const q = await ctx.http(`https://api.supabase.com/v1/projects/${p.id}/database/query`, {
            method: 'POST', headers, body: JSON.stringify({ query: 'select pg_database_size(current_database()) as size' })
          })
          size = q.ok ? Number(q.json?.[0]?.size ?? NaN) : null
          if (Number.isNaN(size)) size = null
        }
        const v = evalSupabase(p, size, t)
        rows.push({
          name: p.name, ref: p.id, projectStatus: p.status, sizeMb: size == null ? null : Math.round(size / 2 ** 20),
          pct: v.pct, status: v.status, dashboard: `https://supabase.com/dashboard/project/${p.id}`
        })
      }
      const bad = rows.filter((x) => x.status !== 'ok')
      const summary = bad.length
        ? bad.map((x) => (x.projectStatus !== 'ACTIVE_HEALTHY' ? `${x.name}: ${x.projectStatus}` : `${x.name}: ${x.pct}% of ${t.supabaseLimitMb} MB`)).join(', ')
        : rows.map((x) => `${x.name} ${x.sizeMb ?? '?'} MB`).join(' · ')
      return result(worst(rows.map((x) => x.status)), summary, {
        details: { projects: rows },
        metrics: Object.fromEntries(rows.filter((x) => x.sizeMb != null).map((x) => [`mb_${x.name}`, x.sizeMb])),
        shortcuts: bad.length === 1 ? [{ kind: 'openUrl', label: 'Open in Supabase', url: bad[0].dashboard }] : []
      })
    }
  },
  {
    id: 'cloud.apikeys', area: 'cloud', title: 'API keys', intervalMs: 24 * 3_600_000, timeoutMs: 90_000,
    async run(ctx) {
      const rows = []
      for (const tester of API_TESTERS) {
        const secrets = Object.fromEntries(tester.secrets.map((k) => [k, ctx.settings.secret(k)]))
        if (Object.values(secrets).some((v) => !v)) continue
        const req = tester.request(secrets)
        const res = await ctx.http(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body, timeoutMs: 15_000 })
        let status = tester.verdict(res)
        let quota = null
        if (status === 'ok' && tester.extra) {
          quota = await tester.extra(ctx, res)
          if (quota && quota.pct < 10) status = 'warn'
        }
        rows.push({ name: tester.name, httpStatus: res.status, status, quota })
      }
      if (!rows.length) return NOT_CONFIGURED('API keys (try Import from apps)')
      const bad = rows.filter((x) => x.status === 'fail' || x.status === 'warn')
      const summary = bad.length
        ? bad.map((x) => (x.status === 'fail' ? `${x.name} key rejected` : `${x.name} quota ${x.quota.pct}% left`)).join(', ')
        : `${rows.length} keys valid` + (rows.find((x) => x.quota) ? ` · eBay ${rows.find((x) => x.quota).quota.pct}% quota left` : '')
      return result(worst(rows.map((x) => x.status)), summary, { details: { keys: rows } })
    }
  }
]
