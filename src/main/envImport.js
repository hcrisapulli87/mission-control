// "Import from apps": finds API keys Harrison's other apps already hold so he
// never types them in. Sources are read once, read-only; values are copied into
// Mission Control's own encrypted secrets — no ongoing dependency on those apps.
import { join } from 'path'

export function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

const NAMES = {
  tmdb_api_key: 'tmdbKey',
  igdb_client_id: 'igdbClientId',
  igdb_client_secret: 'igdbClientSecret',
  ebay_client_id: 'ebayClientId',
  ebay_app_id: 'ebayClientId',
  ebay_client_secret: 'ebayClientSecret',
  ebay_cert_id: 'ebayClientSecret',
  pokemontcg_api_key: 'pokemonTcgKey',
  pokemon_tcg_api_key: 'pokemonTcgKey',
  steamgriddb_api_key: 'steamGridDbKey',
  artworkapikey: 'steamGridDbKey',
  steam_api_key: 'steamKey'
}

export const secretFor = (name) => NAMES[name.toLowerCase().replace(/^vite_/, '')] ?? null

// Secrets that only work as a pair must come from the same source.
const PAIRS = [['ebayClientId', 'ebayClientSecret'], ['igdbClientId', 'igdbClientSecret']]

/** sources: [{source, entries:{name:value}}] → first complete find per secret. */
export function scanForKeys(sources) {
  const found = new Map()
  for (const { source, entries } of sources) {
    const here = {}
    for (const [name, value] of Object.entries(entries)) {
      const secret = secretFor(name)
      if (secret && typeof value === 'string' && value.trim()) here[secret] = value.trim()
    }
    for (const pair of PAIRS) {
      if (!pair.every((k) => here[k])) pair.forEach((k) => delete here[k])
    }
    for (const [secret, value] of Object.entries(here)) {
      if (!found.has(secret)) found.set(secret, { secret, value, source })
    }
  }
  return [...found.values()]
}

/** Collect candidate sources from disk. `readSettingsTable(path)` returns {key:value} or null. */
export async function gatherSources({ root, appData, fs, readSettingsTable }) {
  const sources = []
  for (const e of await fs.readdir(root)) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
    for (const f of ['.env', '.env.local']) {
      const p = join(root, e.name, f)
      if (fs.exists(p)) sources.push({ source: `${e.name}/${f}`, entries: parseEnv(await fs.readFile(p)) })
    }
  }
  if (fs.exists(appData)) {
    for (const e of await fs.readdir(appData)) {
      if (!e.isDirectory()) continue
      const dir = join(appData, e.name)
      let files = []
      try { files = await fs.readdir(dir) } catch { continue }
      for (const f of files) {
        if (!f.isFile()) continue
        const p = join(dir, f.name)
        if (/config\.json$/i.test(f.name)) {
          try {
            const j = JSON.parse(await fs.readFile(p))
            const flat = Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string'))
            sources.push({ source: `${e.name}/${f.name}`, entries: flat })
          } catch { /* not json */ }
        } else if (/\.db$/i.test(f.name)) {
          const entries = await readSettingsTable(p)
          if (entries) sources.push({ source: `${e.name}/${f.name}`, entries })
        }
      }
    }
  }
  return sources
}
