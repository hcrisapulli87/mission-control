import { describe, it, expect } from 'vitest'
import { validateShortcut, claudeLauncher } from '../src/main/shortcuts.js'
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

describe('LAN http + askClaude', () => {
  it('allows http only to private addresses', () => {
    expect(validateShortcut({ kind: 'openUrl', url: 'http://192.168.0.1' }, exists).ok).toBe(true)
    expect(validateShortcut({ kind: 'openUrl', url: 'http://10.0.0.1/admin' }, exists).ok).toBe(true)
    expect(validateShortcut({ kind: 'openUrl', url: 'http://example.com' }, exists).ok).toBe(false)
    expect(validateShortcut({ kind: 'openUrl', url: 'http://192.168.0.1.evil.com' }, exists).ok).toBe(false)
  })
  it('askClaude needs an existing folder and a sane prompt', () => {
    expect(validateShortcut({ kind: 'askClaude', path: 'C:\\real', prompt: 'help' }, exists).ok).toBe(true)
    expect(validateShortcut({ kind: 'askClaude', path: 'C:\\fake', prompt: 'help' }, exists).ok).toBe(false)
    expect(validateShortcut({ kind: 'askClaude', path: 'C:\\real', prompt: '' }, exists).ok).toBe(false)
    expect(validateShortcut({ kind: 'askClaude', path: 'C:\\real', prompt: 'x'.repeat(60_000) }, exists).ok).toBe(false)
  })
  it('launcher cds into the folder and points claude at the report file', () => {
    const cmd = claudeLauncher('C:\\cc\\bot', 'C:\\Users\\H C\\report-1.md')
    expect(cmd).toContain('cd /d "C:\\cc\\bot"')
    expect(cmd).toContain('claude "Read the Mission Control report at C:\\Users\\H C\\report-1.md')
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
