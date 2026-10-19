import { unknown } from './status.js'

const MAX_BACKOFF = 4

function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError()), ms) })
  ])
}
class TimeoutError extends Error {}

/**
 * Runs each check on its own interval. A check that throws or times out yields
 * `unknown` — the scheduler itself never dies. Results from one tick are handed
 * to onTick together so the caller can persist once.
 */
export function createScheduler({ checks, makeCtx, onTick, now = Date.now, maxConcurrent = 4, staggerMs = 10_000 }) {
  const due = new Map()
  const backoff = new Map()
  const running = new Set()
  let timer = null
  let ticking = null

  async function runOne(check) {
    running.add(check.id)
    const started = now()
    let res
    try {
      res = await withTimeout(Promise.resolve().then(() => check.run(makeCtx(check))), check.timeoutMs ?? 30_000)
      res = res ?? unknown('Check returned nothing')
    } catch (err) {
      res = err instanceof TimeoutError ? unknown('Check timed out') : unknown(`Check error: ${err.message}`, { error: err.message })
    }
    const mult = res.networkError ? Math.min((backoff.get(check.id) ?? 1) * 2, MAX_BACKOFF) : 1
    backoff.set(check.id, mult)
    due.set(check.id, started + check.intervalMs * mult)
    running.delete(check.id)
    const { networkError, ...clean } = res
    return { id: check.id, area: check.area, title: check.title, ...clean, checkedAt: started }
  }

  async function tick() {
    if (ticking) return ticking
    ticking = (async () => {
      const queue = checks.filter((c) => !running.has(c.id) && (due.get(c.id) ?? 0) <= now())
      const results = []
      const workers = Array.from({ length: Math.min(maxConcurrent, queue.length) }, async () => {
        while (queue.length) results.push(await runOne(queue.shift()))
      })
      await Promise.all(workers)
      if (results.length) await onTick(results)
    })()
    try { await ticking } finally { ticking = null }
  }

  return {
    init() {
      const t = now()
      checks.forEach((c, i) => due.set(c.id, t + Math.floor((i / Math.max(checks.length, 1)) * staggerMs)))
    },
    start(pollMs = 1000) {
      this.init()
      timer = setInterval(() => { tick().catch(() => {}) }, pollMs)
    },
    stop() { clearInterval(timer) },
    tick,
    async runNow(id) {
      if (ticking) await ticking
      due.set(id, 0)
      await tick()
    },
    async runAll() {
      if (ticking) await ticking
      for (const c of checks) due.set(c.id, 0)
      await tick()
    },
    nextAt: (id) => due.get(id)
  }
}
