import { unknown } from './status.js'

const MAX_BACKOFF = 4

class TimeoutError extends Error {}

function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError()), ms) })
  ])
}

/**
 * Runs each check on its own interval through one global queue (max N at once).
 * A check that throws or times out yields `unknown` — the scheduler never dies.
 * Results are flushed to onTick in small batches as checks complete, so one slow
 * check never holds back the others, and the caller still persists once per batch.
 */
export function createScheduler({
  checks, makeCtx, onTick, now = Date.now, maxConcurrent = 4, staggerMs = 10_000, flushDelayMs = 250
}) {
  const due = new Map()
  const backoff = new Map()
  const queued = new Set()
  const queue = []
  const done = new Map() // id → resolver for tick() callers awaiting completion
  let active = 0
  let pending = []
  let flushTimer = null
  let timer = null

  async function runOne(check) {
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
    const { networkError, ...clean } = res
    return { id: check.id, area: check.area, title: check.title, ...clean, checkedAt: started }
  }

  async function flush() {
    clearTimeout(flushTimer)
    flushTimer = null
    if (!pending.length) return
    const batch = pending
    pending = []
    await onTick(batch)
  }

  function pump() {
    while (active < maxConcurrent && queue.length) {
      const check = queue.shift()
      active++
      runOne(check).then(async (r) => {
        active--
        queued.delete(check.id)
        pending.push(r)
        if (!flushTimer) flushTimer = setTimeout(() => { flush().catch(() => {}) }, flushDelayMs)
        const resolve = done.get(check.id)
        done.delete(check.id)
        pump()
        resolve?.()
      })
    }
  }

  function enqueue(ids) {
    const waits = []
    for (const c of checks) {
      if (!ids.has(c.id) || queued.has(c.id)) continue
      queued.add(c.id)
      queue.push(c)
      waits.push(new Promise((r) => done.set(c.id, r)))
    }
    pump()
    return waits
  }

  /** Queue every due check; resolves once those have finished and been flushed. */
  async function tick() {
    const ids = new Set(checks.filter((c) => (due.get(c.id) ?? 0) <= now()).map((c) => c.id))
    const waits = enqueue(ids)
    await Promise.all(waits)
    await flush()
  }

  return {
    init() {
      const t = now()
      checks.forEach((c, i) => due.set(c.id, t + Math.floor((i / Math.max(checks.length, 1)) * staggerMs)))
    },
    start(pollMs = 1000) {
      this.init()
      timer = setInterval(() => {
        const ids = new Set(checks.filter((c) => (due.get(c.id) ?? 0) <= now()).map((c) => c.id))
        enqueue(ids)
      }, pollMs)
    },
    stop() { clearInterval(timer) },
    tick,
    async runNow(id) {
      due.set(id, 0)
      await Promise.all(enqueue(new Set([id])))
      await flush()
    },
    async runAll() {
      await Promise.all(enqueue(new Set(checks.map((c) => c.id))))
      await flush()
    },
    nextAt: (id) => due.get(id)
  }
}
