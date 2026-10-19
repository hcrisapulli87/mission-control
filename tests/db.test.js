import { describe, it, expect, beforeAll } from 'vitest'
import initSqlJs from 'sql.js'
import { openDb } from '../src/main/db.js'

let SQL
beforeAll(async () => { SQL = await initSqlJs() })

const mk = (opts = {}) => {
  const saved = []
  const db = openDb({ SQL, load: () => opts.bytes ?? null, save: (b) => saved.push(b), onCorrupt: opts.onCorrupt })
  return { db, saved }
}

describe('db', () => {
  it('round-trips results', () => {
    const { db } = mk()
    db.saveResult({ id: 'bot.process', area: 'bot', title: 'Bot', status: 'fail', summary: 'down', details: { n: 0 }, shortcuts: [{ kind: 'copy', label: 'x', text: 'y' }], checkedAt: 5 })
    db.saveResult({ id: 'bot.process', area: 'bot', title: 'Bot', status: 'ok', summary: 'up', details: {}, shortcuts: [], checkedAt: 6 })
    const rows = db.getResults()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'bot.process', status: 'ok', summary: 'up', checkedAt: 6, shortcuts: [] })
  })

  it('events get increasing ids even after persist', () => {
    const { db, saved } = mk()
    const a = db.addEvent({ kind: 'transition', checkId: 'x', from: 'ok', to: 'fail', ts: 1 })
    db.persist()
    const b = db.addEvent({ kind: 'transition', checkId: 'x', from: 'fail', to: 'ok', ts: 2 })
    expect(a).toBe(1)
    expect(b).toBe(2)
    expect(saved).toHaveLength(1)
    expect(db.getEvents({ kind: 'transition' }).map((e) => e.id)).toEqual([2, 1])
  })

  it('opens and closes outages', () => {
    const { db } = mk()
    db.openOutage(100)
    db.openOutage(110) // already open: no second outage
    expect(db.getOpenOutage()).toMatchObject({ data: { start: 100 } })
    db.closeOutage(160)
    expect(db.getOpenOutage()).toBeNull()
    const [o] = db.getEvents({ kind: 'outage' })
    expect(o.data).toEqual({ start: 100, end: 160, durationMs: 60 })
  })

  it('metrics filter by time and prune', () => {
    const { db } = mk()
    db.addMetric('pc.gpu', 'temp', 50, 10)
    db.addMetric('pc.gpu', 'temp', 60, 20)
    expect(db.getMetrics('pc.gpu', 'temp', 15)).toEqual([{ value: 60, ts: 20 }])
    db.prune(15)
    expect(db.getMetrics('pc.gpu', 'temp', 0)).toHaveLength(1)
  })

  it('devices keep user meta across upserts', () => {
    const { db } = mk()
    db.upsertDevice({ mac: 'aa', ip: '1', vendor: 'Apple', ts: 1 })
    db.setDeviceMeta('aa', { name: 'Phone', known: true })
    db.upsertDevice({ mac: 'aa', ip: '2', vendor: 'Apple', ts: 5 })
    expect(db.getDevices()[0]).toMatchObject({ mac: 'aa', ip: '2', name: 'Phone', known: true, firstSeen: 1, lastSeen: 5 })
  })

  it('token hashes, alerts and kv', () => {
    const { db } = mk()
    expect(db.getTokenHash('t')).toBeNull()
    db.setTokenHash('t', 'h', 3)
    expect(db.getTokenHash('t')).toEqual({ hash: 'h', firstSeen: 3 })
    db.setAlert('x', { lastNotifiedAt: 1, mutedUntil: 0, muteUntilRecover: true })
    expect(db.getAlert('x')).toEqual({ lastNotifiedAt: 1, mutedUntil: 0, muteUntilRecover: true })
    expect(db.getAlert('y')).toEqual({ lastNotifiedAt: 0, mutedUntil: 0, muteUntilRecover: false })
    db.kvSet('a', { b: 1 })
    expect(db.kvGet('a')).toEqual({ b: 1 })
    expect(db.kvGet('missing', 7)).toBe(7)
  })

  it('reloads from saved bytes', () => {
    const { db, saved } = mk()
    db.kvSet('k', 1)
    db.persist()
    const { db: db2 } = mk({ bytes: saved[0] })
    expect(db2.kvGet('k')).toBe(1)
  })

  it('corrupt bytes start fresh and report', () => {
    let reported = false
    const { db } = mk({ bytes: new Uint8Array([1, 2, 3, 4, 5]), onCorrupt: () => { reported = true } })
    expect(reported).toBe(true)
    expect(db.getResults()).toEqual([])
  })
})
