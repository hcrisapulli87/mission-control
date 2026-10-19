import { describe, it, expect } from 'vitest'
import { parseAudit, auditVerdict } from '../src/main/checks/audit.js'

describe('parseAudit', () => {
  it('reads npm 7+ metadata', () => {
    const json = JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 1, moderate: 2, high: 0, critical: 1, total: 4 } } })
    expect(parseAudit(json)).toEqual({ low: 1, moderate: 2, high: 0, critical: 1 })
  })
  it('null on garbage', () => expect(parseAudit('not json')).toBeNull())
})

describe('auditVerdict', () => {
  it('high/critical fail, moderate warn, low ok', () => {
    expect(auditVerdict({ low: 0, moderate: 0, high: 1, critical: 0 })).toBe('fail')
    expect(auditVerdict({ low: 0, moderate: 3, high: 0, critical: 0 })).toBe('warn')
    expect(auditVerdict({ low: 5, moderate: 0, high: 0, critical: 0 })).toBe('ok')
  })
})
