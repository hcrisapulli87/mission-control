import { describe, it, expect } from 'vitest'
import { decideAlert, trayStatus } from '../src/main/alerts.js'

const DAY = 86_400_000
const fresh = { lastNotifiedAt: 0, mutedUntil: 0, muteUntilRecover: false }

describe('decideAlert', () => {
  it('notifies on transition into fail', () => {
    const d = decideAlert({ prevStatus: 'ok', nextStatus: 'fail', alert: fresh, now: 100 })
    expect(d.notify).toBe('fail')
    expect(d.alert.lastNotifiedAt).toBe(100)
  })
  it('first-ever fail (no previous) notifies', () => {
    expect(decideAlert({ prevStatus: undefined, nextStatus: 'fail', alert: fresh, now: 1 }).notify).toBe('fail')
  })
  it('stays quiet while still failing within 24h', () => {
    const d = decideAlert({ prevStatus: 'fail', nextStatus: 'fail', alert: { ...fresh, lastNotifiedAt: 0 }, now: DAY - 1 })
    expect(d.notify).toBeNull()
  })
  it('reminds after 24h of failing', () => {
    const d = decideAlert({ prevStatus: 'fail', nextStatus: 'fail', alert: { ...fresh, lastNotifiedAt: 0 }, now: DAY })
    expect(d.notify).toBe('remind')
    expect(d.alert.lastNotifiedAt).toBe(DAY)
  })
  it('recovery notifies and clears mute-until-recover', () => {
    const d = decideAlert({ prevStatus: 'fail', nextStatus: 'ok', alert: { ...fresh, muteUntilRecover: true }, now: 5 })
    expect(d.notify).toBeNull()
    expect(d.alert.muteUntilRecover).toBe(false)
    const d2 = decideAlert({ prevStatus: 'fail', nextStatus: 'ok', alert: fresh, now: 5 })
    expect(d2.notify).toBe('recover')
  })
  it('warn and unknown never notify', () => {
    expect(decideAlert({ prevStatus: 'ok', nextStatus: 'warn', alert: fresh, now: 1 }).notify).toBeNull()
    expect(decideAlert({ prevStatus: 'ok', nextStatus: 'unknown', alert: fresh, now: 1 }).notify).toBeNull()
  })
  it('fail→unknown is not a recovery', () => {
    expect(decideAlert({ prevStatus: 'fail', nextStatus: 'unknown', alert: fresh, now: 1 }).notify).toBeNull()
  })
  it('timed mute suppresses', () => {
    expect(decideAlert({ prevStatus: 'ok', nextStatus: 'fail', alert: { ...fresh, mutedUntil: 50 }, now: 10 }).notify).toBeNull()
    expect(decideAlert({ prevStatus: 'ok', nextStatus: 'fail', alert: { ...fresh, mutedUntil: 50 }, now: 60 }).notify).toBe('fail')
  })
})

describe('trayStatus', () => {
  it('ignores muted checks', () => {
    const results = [{ id: 'a', status: 'fail' }, { id: 'b', status: 'warn' }]
    expect(trayStatus(results, { a: { ...fresh, muteUntilRecover: true } }, 0)).toBe('warn')
    expect(trayStatus(results, {}, 0)).toBe('fail')
  })
})
