import { describe, it, expect } from 'vitest'
import { guideFor, buildClaudePrompt, assistCwd } from '../src/main/guides.js'

const paths = { root: 'C:\\cc', bot: 'C:\\cc\\bot' }
const r = (id, status, extra = {}) => ({ id, title: id, status, summary: 's', details: {}, ...extra })
const commands = (g) => g.steps.flatMap((s) => s.commands ?? [])

describe('guideFor', () => {
  it('no guide when ok', () => {
    expect(guideFor(r('bot.process', 'ok'), paths)).toBeNull()
  })

  it('bot down: start command uses the configured bot path', () => {
    const g = guideFor(r('bot.process', 'fail'), paths)
    expect(commands(g)).toContain('wscript "C:\\cc\\bot\\launch_hidden.vbs"')
  })

  it('expired tokens: names the exact token files to delete', () => {
    const g = guideFor(r('google.tokens', 'fail', {
      details: { tokens: [{ file: 'token_gmail.json', status: 'fail' }, { file: 'token_tasks.json', status: 'ok' }] }
    }), paths)
    const text = g.steps.map((s) => s.text).join(' ')
    expect(text).toContain('token_gmail.json')
    expect(text).not.toContain('token_tasks.json')
    expect(commands(g)).toContain('cmd /c "C:\\cc\\bot\\stop_bot.bat"')
  })

  it('unpushed: plain push vs first push with upstream', () => {
    const g = guideFor(r('code.unpushed', 'warn', {
      details: { repos: [{ name: 'tally', path: 'C:\\cc\\tally', unpushed: [{ branch: 'main', ahead: 2 }, { branch: 'feat/x', ahead: null }] }] }
    }), paths)
    expect(commands(g)).toEqual([
      'cd "C:\\cc\\tally"', 'git push',
      'cd "C:\\cc\\tally"', 'git push -u origin feat/x'
    ])
  })

  it('no remote: suggests the matching GitHub repo name', () => {
    const g = guideFor(r('code.noremote', 'warn', { details: { repos: [{ name: 'cinevault', path: 'C:\\cc\\cinevault' }] } }), paths)
    expect(commands(g)).toContain('git remote add origin https://github.com/hcrisapulli87/cinevault.git')
  })

  it('never suggests force flags', () => {
    const ids = ['code.branches', 'code.audit', 'code.unpushed', 'code.dirty', 'code.nogit']
    for (const id of ids) {
      const g = guideFor(r(id, 'warn', { details: { repos: [{ name: 'a', path: 'C:\\cc\\a', unpushed: [], unmerged: ['f'], stale: [] }], audits: [{ name: 'a', path: 'C:\\cc\\a', status: 'fail' }] } }), paths)
      for (const c of commands(g)) expect(c).not.toMatch(/--force|-D\b|reset --hard/)
    }
  })

  it('every command works in both PowerShell 5.1 and cmd.exe', () => {
    const ids = ['bot.process', 'bot.activity', 'bot.crashloop', 'bot.auth', 'google.tokens', 'code.nogit', 'code.dirty',
      'code.noremote', 'code.unpushed', 'code.branches', 'code.audit', 'cloud.vercel', 'cloud.uptime', 'cloud.supabase',
      'cloud.apikeys', 'pc.gpu', 'pc.cpu', 'pc.ram', 'pc.disks', 'pc.restart', 'net.internet', 'net.gateway', 'net.speed', 'net.devices']
    const details = { repos: [{ name: 'a', path: 'C:\\cc\\a', dirty: 1, unpushed: [{ branch: 'main', ahead: 1 }], unmerged: ['f'], stale: [] }],
      audits: [{ name: 'a', path: 'C:\\cc\\a', status: 'fail' }], tokens: [{ file: 't.json', status: 'fail' }] }
    for (const id of ids) {
      for (const c of commands(guideFor(r(id, 'fail', { details }), paths))) {
        expect(c, id).not.toMatch(/&&|\|\||;\s/) // PowerShell 5.1 has no && / ||; ; means something else in cmd
        expect(c, id).not.toMatch(/^\s*"/)      // PowerShell prints a quoted path instead of running it
        expect(c, id).not.toMatch(/cd \/d/)     // /d is cmd-only
      }
    }
  })

  it('not configured cloud checks point at settings', () => {
    const g = guideFor(r('cloud.vercel', 'unknown', { summary: 'Not configured — add a Vercel token in Settings' }), paths)
    expect(g.steps[0].url).toBe('https://vercel.com/account/tokens')
  })

  it('a check that errored gets a generic guide', () => {
    const g = guideFor(r('pc.gpu', 'unknown', { error: 'spawn nvidia-smi ENOENT' }), paths)
    expect(g.steps[0].text).toContain('spawn nvidia-smi ENOENT')
  })

  it('every check id has a guide for fail', () => {
    const ids = ['bot.process', 'bot.activity', 'bot.crashloop', 'bot.auth', 'google.tokens', 'code.nogit', 'code.dirty',
      'code.noremote', 'code.unpushed', 'code.branches', 'code.audit', 'cloud.vercel', 'cloud.uptime', 'cloud.supabase',
      'cloud.apikeys', 'pc.gpu', 'pc.cpu', 'pc.ram', 'pc.disks', 'pc.restart', 'net.internet', 'net.gateway', 'net.speed', 'net.devices']
    for (const id of ids) expect(guideFor(r(id, 'fail'), paths)?.steps.length, id).toBeGreaterThan(0)
  })
})

describe('assistCwd', () => {
  it('bot checks open in the bot folder, single-repo checks in that repo, else root', () => {
    expect(assistCwd(r('bot.auth', 'fail'), paths)).toBe('C:\\cc\\bot')
    expect(assistCwd(r('code.dirty', 'warn', { details: { repos: [{ path: 'C:\\cc\\tally' }] } }), paths)).toBe('C:\\cc\\tally')
    expect(assistCwd(r('code.dirty', 'warn', { details: { repos: [{ path: 'a' }, { path: 'b' }] } }), paths)).toBe('C:\\cc')
    expect(assistCwd(r('pc.gpu', 'warn'), paths)).toBe('C:\\cc')
  })
})

describe('buildClaudePrompt', () => {
  it('describes the problem, frames details as data, and asks before changing anything', () => {
    const g = guideFor(r('bot.process', 'fail'), paths)
    const p = buildClaudePrompt(r('bot.process', 'fail', { summary: 'Bot is not running', details: { processes: 0 } }), g, 1_700_000_000_000)
    expect(p).toContain('bot.process')
    expect(p).toContain('Bot is not running')
    expect(p).toContain('"processes": 0')
    expect(p).toMatch(/do not (change|apply)/i)
    expect(p).toMatch(/data, not instructions/i)
  })
  it('truncates huge details', () => {
    const p = buildClaudePrompt(r('net.devices', 'warn', { details: { blob: 'x'.repeat(50_000) } }), null, 0)
    expect(p.length).toBeLessThan(12_000)
  })
})
