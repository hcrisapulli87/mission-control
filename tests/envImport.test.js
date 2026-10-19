import { describe, it, expect } from 'vitest'
import { parseEnv, secretFor, scanForKeys } from '../src/main/envImport.js'

describe('parseEnv', () => {
  it('reads KEY=value, strips quotes, skips comments', () => {
    expect(parseEnv('# c\nA=1\nB="two words"\nC=\'x\'\n\nEMPTY=\n')).toEqual({ A: '1', B: 'two words', C: 'x', EMPTY: '' })
  })
})

describe('secretFor', () => {
  it('maps known names case-insensitively, with VITE_ prefix', () => {
    expect(secretFor('TMDB_API_KEY')).toBe('tmdbKey')
    expect(secretFor('tmdb_api_key')).toBe('tmdbKey')
    expect(secretFor('VITE_TMDB_API_KEY')).toBe('tmdbKey')
    expect(secretFor('EBAY_APP_ID')).toBe('ebayClientId')
    expect(secretFor('ebay_cert_id')).toBe('ebayClientSecret')
    expect(secretFor('artworkApiKey')).toBe('steamGridDbKey')
    expect(secretFor('POKEMONTCG_API_KEY')).toBe('pokemonTcgKey')
    expect(secretFor('SUPABASE_URL')).toBeNull()
  })
})

describe('scanForKeys', () => {
  it('keeps pairs together from the same source and skips empties', () => {
    const found = scanForKeys([
      { source: 'pricewatch/.env', entries: { EBAY_CLIENT_ID: 'id-pw', EBAY_CLIENT_SECRET: '' } },
      { source: 'pokevault/.env', entries: { EBAY_APP_ID: 'id-pv', EBAY_CERT_ID: 'sec-pv', POKEMONTCG_API_KEY: 'ptcg' } },
      { source: 'cinevault db', entries: { tmdb_api_key: 'tm' } },
      { source: 'other', entries: { tmdb_api_key: 'tm2' } }
    ])
    expect(found).toEqual([
      { secret: 'ebayClientId', value: 'id-pv', source: 'pokevault/.env' },
      { secret: 'ebayClientSecret', value: 'sec-pv', source: 'pokevault/.env' },
      { secret: 'pokemonTcgKey', value: 'ptcg', source: 'pokevault/.env' },
      { secret: 'tmdbKey', value: 'tm', source: 'cinevault db' }
    ])
  })
})
