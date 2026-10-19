import { describe, it, expect } from 'vitest'
import { evalDeployment, uptimeVerdict, evalSupabase, API_TESTERS, ebayQuota } from '../src/main/checks/cloud.js'

const MIN = 60_000

describe('evalDeployment', () => {
  it('ready is ok, error fails, long builds warn', () => {
    expect(evalDeployment({ state: 'READY', created: 0 }, 5 * MIN)).toBe('ok')
    expect(evalDeployment({ state: 'ERROR', created: 0 }, 5 * MIN)).toBe('fail')
    expect(evalDeployment({ readyState: 'CANCELED', created: 0 }, 5 * MIN)).toBe('fail')
    expect(evalDeployment({ state: 'BUILDING', created: 0 }, 10 * MIN)).toBe('ok')
    expect(evalDeployment({ state: 'BUILDING', created: 0 }, 31 * MIN)).toBe('warn')
    expect(evalDeployment(null, 0)).toBe('unknown')
  })
})

describe('uptimeVerdict', () => {
  it('status and latency', () => {
    expect(uptimeVerdict({ status: 200, ms: 300 }, 3000)).toBe('ok')
    expect(uptimeVerdict({ status: 301, ms: 300 }, 3000)).toBe('ok')
    expect(uptimeVerdict({ status: 200, ms: 3500 }, 3000)).toBe('warn')
    expect(uptimeVerdict({ status: 500, ms: 100 }, 3000)).toBe('fail')
    expect(uptimeVerdict({ status: 0, error: 'timeout' }, 3000)).toBe('fail')
  })
})

describe('evalSupabase', () => {
  const t = { supabaseWarnPct: 70, supabaseFailPct: 90, supabaseLimitMb: 500 }
  it('paused or unhealthy fails', () => {
    expect(evalSupabase({ status: 'INACTIVE' }, null, t).status).toBe('fail')
    expect(evalSupabase({ status: 'ACTIVE_HEALTHY' }, 100 * 2 ** 20, t)).toEqual({ status: 'ok', pct: 20 })
    expect(evalSupabase({ status: 'ACTIVE_HEALTHY' }, 360 * 2 ** 20, t).status).toBe('warn')
    expect(evalSupabase({ status: 'ACTIVE_HEALTHY' }, 460 * 2 ** 20, t).status).toBe('fail')
    expect(evalSupabase({ status: 'ACTIVE_HEALTHY' }, null, t).status).toBe('ok')
  })
})

describe('API testers', () => {
  it('tmdb supports v3 keys and v4 bearer tokens', () => {
    const tmdb = API_TESTERS.find((x) => x.name === 'TMDB')
    expect(tmdb.request({ tmdbKey: 'abc' }).url).toContain('api_key=abc')
    expect(tmdb.request({ tmdbKey: 'eyJhbGciOi' }).headers.Authorization).toBe('Bearer eyJhbGciOi')
  })
  it('401/403 means invalid, 200 valid, 0 unknown', () => {
    const t = API_TESTERS.find((x) => x.name === 'Pokémon TCG')
    expect(t.verdict({ status: 200 })).toBe('ok')
    expect(t.verdict({ status: 401 })).toBe('fail')
    expect(t.verdict({ status: 403 })).toBe('fail')
    expect(t.verdict({ status: 0, error: 'timeout' })).toBe('unknown')
  })
  it('every tester declares its secrets', () => {
    for (const t of API_TESTERS) expect(t.secrets.length).toBeGreaterThan(0)
  })
})

describe('ebayQuota', () => {
  it('lowest remaining share across resources', () => {
    const json = { rateLimits: [{ apiName: 'Browse', resources: [
      { name: 'buy.browse', rates: [{ limit: 5000, remaining: 4000 }] },
      { name: 'buy.browse.item', rates: [{ limit: 1000, remaining: 50 }] }
    ] }] }
    expect(ebayQuota(json)).toEqual({ remaining: 50, limit: 1000, pct: 5 })
    expect(ebayQuota({})).toBeNull()
  })
})
