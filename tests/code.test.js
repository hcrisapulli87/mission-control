import { describe, it, expect } from 'vitest'
import { parsePorcelain, parseRefs, isProject, evaluateRepo } from '../src/main/checks/code.js'

const DAY = 86_400_000

describe('git parsers', () => {
  it('counts porcelain entries', () => {
    expect(parsePorcelain(' M src/a.js\n?? b.txt\n')).toBe(2)
    expect(parsePorcelain('')).toBe(0)
  })
  it('parses for-each-ref with tracking info', () => {
    const text = [
      'main|1760000000|origin/main|[ahead 2]',
      'feat/x|1750000000||',
      'old|1700000000|origin/old|[gone]',
      'synced|1760000000|origin/synced|',
      'both|1760000000|origin/both|[ahead 1, behind 3]'
    ].join('\n')
    expect(parseRefs(text)).toEqual([
      { name: 'main', ts: 1760000000000, upstream: 'origin/main', ahead: 2, gone: false },
      { name: 'feat/x', ts: 1750000000000, upstream: null, ahead: 0, gone: false },
      { name: 'old', ts: 1700000000000, upstream: 'origin/old', ahead: 0, gone: true },
      { name: 'synced', ts: 1760000000000, upstream: 'origin/synced', ahead: 0, gone: false },
      { name: 'both', ts: 1760000000000, upstream: 'origin/both', ahead: 1, gone: false }
    ])
  })
})

describe('isProject', () => {
  it('needs git, package.json or python files and not ignored', () => {
    expect(isProject({ name: 'a', files: ['package.json'] }, [])).toBe(true)
    expect(isProject({ name: 'b', files: ['bot.py'] }, [])).toBe(true)
    expect(isProject({ name: 'c', files: ['.git'] }, [])).toBe(true)
    expect(isProject({ name: 'd', files: ['readme.md'] }, [])).toBe(false)
    expect(isProject({ name: 'docs', files: ['package.json'] }, ['docs'])).toBe(false)
  })
})

describe('evaluateRepo', () => {
  const now = 100 * DAY
  const repo = {
    name: 'tally', git: true, dirty: 3, hasOrigin: true, mainBranch: 'main',
    merged: ['main', 'feat/done'],
    branches: [
      { name: 'main', ts: now, upstream: 'origin/main', ahead: 2, gone: false },
      { name: 'feat/done', ts: now, upstream: null, ahead: 0, gone: false },
      { name: 'feat/new', ts: now - DAY, upstream: null, ahead: 0, gone: false },
      { name: 'feat/old', ts: now - 20 * DAY, upstream: 'origin/feat/old', ahead: 0, gone: false }
    ]
  }
  it('flags each concern', () => {
    const e = evaluateRepo(repo, now, 14)
    expect(e.nogit).toBe(false)
    expect(e.dirty).toBe(3)
    expect(e.noremote).toBe(false)
    expect(e.unpushed).toEqual([{ branch: 'main', ahead: 2 }, { branch: 'feat/new', ahead: null }])
    expect(e.unmerged).toEqual(['feat/new', 'feat/old'])
    expect(e.stale).toEqual(['feat/old'])
  })
  it('no remote: unpushed not reported (noremote covers it)', () => {
    const e = evaluateRepo({ ...repo, hasOrigin: false }, now, 14)
    expect(e.noremote).toBe(true)
    expect(e.unpushed).toEqual([])
  })
  it('no remote but listed as local-only: not flagged', () => {
    const e = evaluateRepo({ ...repo, hasOrigin: false }, now, 14, [repo.name])
    expect(e.noremote).toBe(false)
    expect(e.unpushed).toEqual([])
    expect(evaluateRepo({ ...repo, hasOrigin: false }, now, 14, ['other']).noremote).toBe(true)
  })
  it('non-git folder', () => {
    expect(evaluateRepo({ name: 'chordvault', git: false }, now, 14)).toMatchObject({ nogit: true, dirty: 0, unmerged: [] })
  })
})
