// Secrets (API tokens/keys) live in their own file, each value encrypted with
// Electron safeStorage (Windows DPAPI). Plaintext never touches disk, and the
// renderer only ever sees masked values.

export function createSecrets({ file, crypto, fs }) {
  let store = {}
  if (fs.exists(file)) {
    try { store = JSON.parse(fs.readFile(file)) } catch { store = {} }
  }
  const write = () => fs.writeFile(file, JSON.stringify(store, null, 2))

  return {
    get(key) {
      if (!store[key]) return null
      try { return crypto.decrypt(store[key]) } catch { return null }
    },
    set(key, value) {
      if (!value) {
        delete store[key]
      } else {
        if (!crypto.available()) throw new Error('OS encryption unavailable; refusing to store secret')
        store[key] = crypto.encrypt(String(value))
      }
      write()
    },
    masked() {
      const out = {}
      for (const key of Object.keys(store)) {
        const v = this.get(key)
        if (v) out[key] = '••••' + v.slice(-4)
      }
      return out
    }
  }
}
