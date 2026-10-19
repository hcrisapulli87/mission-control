// Builds src/main/oui.json (MAC prefix → short vendor name) from the IEEE registry.
//   curl -sSL -o scripts/oui.csv https://standards-oui.ieee.org/oui/oui.csv
//   node scripts/make-oui.mjs
import { readFileSync, writeFileSync } from 'fs'

const csv = readFileSync(new URL('./oui.csv', import.meta.url), 'utf8')

function parseLine(line) {
  const out = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
    } else if (c === ',' && !quoted) { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

const SUFFIX = /[,.]?\s+(co\.?,?\s*ltd\.?|corporation|corp\.?|inc\.?|incorporated|limited|ltd\.?|llc|gmbh|s\.?a\.?|ag|pte\.?|technologies|technology|electronics|communications?)\.?$/i

function shorten(name) {
  let n = name.trim().replace(/\s+/g, ' ')
  for (let i = 0; i < 4; i++) n = n.replace(SUFFIX, '').trim()
  return n.replace(/[,.]$/, '')
}

const map = {}
for (const line of csv.split(/\r?\n/).slice(1)) {
  if (!line.startsWith('MA-L,')) continue
  const [, prefix, org] = parseLine(line)
  if (prefix && org) map[prefix.toUpperCase()] = shorten(org)
}
writeFileSync(new URL('../src/main/oui.json', import.meta.url), JSON.stringify(map))
console.log(`${Object.keys(map).length} prefixes`)
