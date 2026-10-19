import { describe, it, expect } from 'vitest'
import { tokenCountdown } from '../src/main/checks/tokens.js'

const DAY = 86_400_000
const base = { warnDays: 2, testingMode: true }

describe('tokenCountdown', () => {
  it('first sighting is a baseline: ok, age unknown', () => {
    const r = tokenCountdown({ ...base, stored: null, hash: 'h1', now: 10 * DAY })
    expect(r.status).toBe('ok')
    expect(r.baseline).toBe(true)
    expect(r.newStored).toEqual({ hash: 'h1', firstSeen: 10 * DAY, baseline: true })
  })
  it('counts down from when the hash changed', () => {
    const stored = { hash: 'h1', firstSeen: 0 }
    expect(tokenCountdown({ ...base, stored, hash: 'h1', now: 3 * DAY })).toMatchObject({ status: 'ok', daysLeft: 4 })
    expect(tokenCountdown({ ...base, stored, hash: 'h1', now: 5.5 * DAY })).toMatchObject({ status: 'warn', daysLeft: 1.5 })
    expect(tokenCountdown({ ...base, stored, hash: 'h1', now: 7 * DAY })).toMatchObject({ status: 'fail', daysLeft: 0 })
  })
  it('baseline sightings warn/fail too once known-age would have expired', () => {
    const stored = { hash: 'h1', firstSeen: 0, baseline: true }
    expect(tokenCountdown({ ...base, stored, hash: 'h1', now: 8 * DAY }).status).toBe('fail')
  })
  it('hash change resets the clock', () => {
    const r = tokenCountdown({ ...base, stored: { hash: 'h1', firstSeen: 0 }, hash: 'h2', now: 6 * DAY })
    expect(r).toMatchObject({ status: 'ok', daysLeft: 7 })
    expect(r.newStored).toEqual({ hash: 'h2', firstSeen: 6 * DAY, baseline: false })
  })
  it('published app (not testing mode) is always ok', () => {
    expect(tokenCountdown({ ...base, testingMode: false, stored: { hash: 'h1', firstSeen: 0 }, hash: 'h1', now: 30 * DAY }).status).toBe('ok')
  })
  it('missing refresh token fails', () => {
    expect(tokenCountdown({ ...base, stored: null, hash: null, now: 0 }).status).toBe('fail')
  })
})
