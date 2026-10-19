import { describe, it, expect } from 'vitest'
import { validateShortcut } from '../src/main/shortcuts.js'
import { startupVbs } from '../src/main/startup.js'
import { allChecks } from '../src/main/checks/index.js'

const exists = (p) => p.startsWith('C:\\real')

describe('validateShortcut', () => {
  it('accepts valid shortcuts', () => {
    expect(validateShortcut({ kind: 'openPath', path: 'C:\\real\\x' }, exists)).toEqual({ ok: true })
    expect(validateShortcut({ kind: 'openInCode', path: 'C:\\real\\x' }, exists)).toEqual({ ok: true })
    expect(validateShortcut({ kind: 'openTerminal', path: 'C:\\real' }, exists)).toEqual({ ok: true })
    expect(validateShortcut({ kind: 'openUrl', url: 'https://vercel.com/x' }, exists)).toEqual({ ok: true })
    expect(validateShortcut({ kind: 'copy', text: 'git push' }, exists)).toEqual({ ok: true })
  })
  it('rejects bad input', () => {
    expect(validateShortcut({ kind: 'openPath', path: 'C:\\fake' }, exists).ok).toBe(false)
    expect(validateShortcut({ kind: 'openUrl', url: 'http://x.com' }, exists).ok).toBe(false)
    expect(validateShortcut({ kind: 'openUrl', url: 'file:///C:/x' }, exists).ok).toBe(false)
    expect(validateShortcut({ kind: 'run', cmd: 'rm' }, exists).ok).toBe(false)
    expect(validateShortcut({ kind: 'copy', text: '' }, exists).ok).toBe(false)
    expect(validateShortcut(null, exists).ok).toBe(false)
  })
})

describe('startupVbs', () => {
  it('launches the app launcher hidden', () => {
    const vbs = startupVbs('C:\\a b\\launch.vbs')
    expect(vbs).toContain('wscript.exe ""C:\\a b\\launch.vbs""')
  })
})

describe('registry', () => {
  it('has unique ids covering all five areas', () => {
    const ids = allChecks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(allChecks.map((c) => c.area))).toEqual(new Set(['bot', 'code', 'cloud', 'pc', 'network']))
    for (const c of allChecks) expect(typeof c.run).toBe('function')
  })
})
