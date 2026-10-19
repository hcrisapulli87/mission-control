import { describe, it, expect } from 'vitest'
import { createScheduler } from '../src/main/scheduler.js'

const check = (id, run, extra = {}) => ({ id, area: 'pc', title: id, intervalMs: 1000, run, ...extra })

function setup(checks, opts = {}) {
  let t = 0
  const ticks = []
  const s = createScheduler({
    checks, makeCtx: () => ({}), onTick: (r) => ticks.push(r), now: () => t, staggerMs: 0, ...opts
  })
  s.init()
  return { s, ticks, advance: (ms) => { t += ms }, at: () => t }
}

describe('scheduler', () => {
  it('runs due checks and stamps results', async () => {
    const { s, ticks } = setup([check('a', async () => ({ status: 'ok', summary: 'fine' }))])
    await s.tick()
    expect(ticks[0][0]).toMatchObject({ id: 'a', area: 'pc', title: 'a', status: 'ok', summary: 'fine', checkedAt: 0 })
  })

  it('throwing check becomes unknown', async () => {
    const { s, ticks } = setup([check('a', async () => { throw new Error('boom') })])
    await s.tick()
    expect(ticks[0][0]).toMatchObject({ status: 'unknown', error: 'boom' })
  })

  it('slow check times out as unknown', async () => {
    const { s, ticks } = setup([check('a', () => new Promise(() => {}), { timeoutMs: 20 })])
    await s.tick()
    expect(ticks[0][0]).toMatchObject({ status: 'unknown', summary: 'Check timed out' })
  })

  it('respects interval and runNow bypasses it', async () => {
    let n = 0
    const { s, advance } = setup([check('a', async () => { n++; return { status: 'ok' } })])
    await s.tick()
    advance(500); await s.tick()
    expect(n).toBe(1)
    await s.runNow('a')
    expect(n).toBe(2)
    advance(1000); await s.tick()
    expect(n).toBe(3)
  })

  it('backs off on network errors and resets on success', async () => {
    let fail = true
    const { s, advance } = setup([check('a', async () => (fail ? { status: 'unknown', networkError: true } : { status: 'ok' }))])
    await s.tick()                       // fail → next in 2000
    expect(s.nextAt('a')).toBe(2000)
    advance(2000); await s.tick()        // fail → next in 4000
    expect(s.nextAt('a')).toBe(2000 + 4000)
    advance(4000); await s.tick()        // capped at 4x
    expect(s.nextAt('a')).toBe(6000 + 4000)
    fail = false
    advance(4000); await s.tick()
    expect(s.nextAt('a')).toBe(10000 + 1000)
  })

  it('a slow check does not hold back fast results', async () => {
    let release
    const slow = check('slow', () => new Promise((r) => { release = () => r({ status: 'ok' }) }))
    const fast = check('fast', async () => ({ status: 'ok' }))
    const { s, ticks } = setup([slow, fast], { flushDelayMs: 5 })
    const pending = s.tick()
    await new Promise((r) => setTimeout(r, 30))
    expect(ticks.flat().map((r) => r.id)).toEqual(['fast'])
    release()
    await pending
    expect(ticks.flat().map((r) => r.id)).toEqual(['fast', 'slow'])
  })

  it('caps concurrency', async () => {
    let inFlight = 0, peak = 0
    const slow = async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return { status: 'ok' } }
    const { s, ticks } = setup(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => check(id, slow)), { maxConcurrent: 2 })
    await s.tick()
    expect(peak).toBe(2)
    expect(ticks.flat()).toHaveLength(6)
  })
})
