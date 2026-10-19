import { describe, it, expect } from 'vitest'
import { worst, STATUS } from '../src/main/status.js'

describe('worst', () => {
  it('picks warn over ok', () => expect(worst(['ok', 'warn'])).toBe('warn'))
  it('fail beats warn', () => expect(worst(['warn', 'fail', 'ok'])).toBe('fail'))
  it('ignores unknown when something is known', () => expect(worst(['unknown', 'ok'])).toBe('ok'))
  it('all unknown stays unknown', () => expect(worst(['unknown'])).toBe('unknown'))
  it('empty is unknown', () => expect(worst([])).toBe(STATUS.UNKNOWN))
})
