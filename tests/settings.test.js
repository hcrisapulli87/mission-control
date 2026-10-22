import { describe, it, expect } from 'vitest'
import { createSecrets } from '../src/main/secrets.js'
import { DEFAULTS, resolveSettings } from '../src/main/settings.js'

const memFs = () => {
  const files = {}
  return {
    files,
    exists: (p) => p in files,
    readFile: (p) => files[p],
    writeFile: (p, s) => { files[p] = s }
  }
}
const fakeCrypto = {
  available: () => true,
  encrypt: (s) => Buffer.from('enc:' + s).toString('base64'),
  decrypt: (b) => Buffer.from(b, 'base64').toString().slice(4)
}

describe('secrets', () => {
  it('encrypts on write and never stores plaintext', () => {
    const fs = memFs()
    const s = createSecrets({ file: 'sec.json', crypto: fakeCrypto, fs })
    s.set('vercelToken', 'abcdef123456')
    expect(fs.files['sec.json']).not.toContain('abcdef123456')
    expect(createSecrets({ file: 'sec.json', crypto: fakeCrypto, fs }).get('vercelToken')).toBe('abcdef123456')
  })
  it('masks values and deletes on empty', () => {
    const s = createSecrets({ file: 'x', crypto: fakeCrypto, fs: memFs() })
    s.set('a', 'secretvalue9876')
    expect(s.masked()).toEqual({ a: '••••9876' })
    s.set('a', '')
    expect(s.masked()).toEqual({})
    expect(s.get('a')).toBeNull()
  })
  it('refuses to store when encryption unavailable', () => {
    const s = createSecrets({ file: 'x', crypto: { ...fakeCrypto, available: () => false }, fs: memFs() })
    expect(() => s.set('a', 'b')).toThrow(/encryption/i)
  })
})

describe('settings', () => {
  it('deep merges overrides onto defaults', () => {
    const s = resolveSettings({ thresholds: { gpuWarn: 75 }, startWithWindows: true }, { get: () => null })
    expect(s.thresholds.gpuWarn).toBe(75)
    expect(s.thresholds.gpuFail).toBe(DEFAULTS.thresholds.gpuFail)
    expect(s.startWithWindows).toBe(true)
    expect(s.paths.root).toBe(DEFAULTS.paths.root)
  })
  it('exposes secrets via getter', () => {
    const s = resolveSettings({}, { get: (k) => (k === 'vercelToken' ? 'tok' : null) })
    expect(s.secret('vercelToken')).toBe('tok')
  })
})
