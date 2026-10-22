import { describe, it, expect } from 'vitest'
import {
  parseBotProcesses, parseLogTime, lastLogTime, countExits, activityVerdict,
  parseStartupApproved, findBotStartupEntries, startupVerdict
} from '../src/main/checks/bot.js'

const H = 3_600_000
const local = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime()

describe('parseBotProcesses', () => {
  const stub = { ProcessId: 10, ParentProcessId: 1, CommandLine: 'venv\Scripts\pythonw.exe  -u bot.py ' }
  const child = { ProcessId: 11, ParentProcessId: 10, CommandLine: '"C:\Python312\pythonw.exe" -u bot.py ' }
  const ambience = { ProcessId: 20, ParentProcessId: 2, CommandLine: '"C:\ambience\.venv\Scripts\pythonw.exe" -m ambience' }
  it('venv stub + child is one instance', () => {
    expect(parseBotProcesses(JSON.stringify([stub, child]))).toEqual({ processes: 2, instances: 1 })
  })
  it('ignores other pythonw apps', () => {
    expect(parseBotProcesses(JSON.stringify([stub, child, ambience]))).toEqual({ processes: 2, instances: 1 })
    expect(parseBotProcesses(JSON.stringify(ambience))).toEqual({ processes: 0, instances: 0 })
  })
  it('two separate launches are two instances', () => {
    const stub2 = { ...stub, ProcessId: 30 }, child2 = { ...child, ProcessId: 31, ParentProcessId: 30 }
    expect(parseBotProcesses(JSON.stringify([stub, child, stub2, child2])).instances).toBe(2)
  })
  it('none running', () => {
    expect(parseBotProcesses('')).toEqual({ processes: 0, instances: 0 })
  })
})

describe('parseLogTime', () => {
  it('bot.log format', () => expect(parseLogTime('2026-09-29 19:01:10,001 [INFO] bot: online')).toBe(local(2026, 9, 29, 19, 1, 10)))
  it('discord bracket format', () => expect(parseLogTime('[2026-09-14 12:08:36] [INFO    ] discord.gateway: x')).toBe(local(2026, 9, 14, 12, 8, 36)))
  it('launcher AU format', () => expect(parseLogTime('[Tue 29/09/2026 21:13:43.84] starting bot ')).toBe(local(2026, 9, 29, 21, 13, 43) + 840))
  it('traceback line has no time', () => expect(parseLogTime('  File "x.py", line 3')).toBeNull())
})

describe('lastLogTime', () => {
  it('finds the latest timestamped line', () => {
    const text = '2026-09-29 15:08:45,503 [INFO] a\n2026-09-29 19:01:10,001 [INFO] b\nTraceback\n'
    expect(lastLogTime(text)).toBe(local(2026, 9, 29, 19, 1, 10))
  })
})

const launcher = [
  '[Mon 19/10/2026 09:00:00.00] starting bot ',
  '[Mon 19/10/2026 09:10:00.00] bot exited, restarting in 30 seconds ',
  '[Mon 19/10/2026 09:10:30.00] starting bot ',
  'google.auth.exceptions.RefreshError: (\'invalid_grant: Bad Request\', {})',
  '[Mon 19/10/2026 09:10:31.00] bot exited, restarting in 30 seconds ',
  '[Mon 19/10/2026 09:11:01.00] starting bot ',
  '    self.service = self._authenticate()',
  '[Mon 19/10/2026 09:11:02.00] bot exited, restarting in 30 seconds ',
  '[Mon 19/10/2026 09:11:32.00] starting bot ',
  '[Mon 19/10/2026 09:11:33.00] bot exited, restarting in 30 seconds '
].join('\r\n')

describe('countExits', () => {
  it('counts exits inside the window', () => {
    expect(countExits(launcher, local(2026, 10, 19, 9, 30), H)).toBe(4)
    expect(countExits(launcher, local(2026, 10, 19, 10, 11, 10), H)).toBe(1)
  })
})

// Real `reg query` output captured on Harrison's PC (the .vbs value is the one from the
// 2026-09-29 outage: switched off at 2:28:28 pm AEST).
const REG = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
  '    start-household-bot.bat    REG_BINARY    020000000000000000000000',
  '    start-household-bot.vbs    REG_BINARY    030000004F6B06FACA4FDD01',
  '    mission-control.vbs    REG_BINARY    020000000000000000000000',
  ''
].join('\r\n')

describe('parseStartupApproved', () => {
  it('reads on/off and when it was switched', () => {
    const a = parseStartupApproved(REG)
    expect(a['start-household-bot.vbs']).toEqual({ enabled: false, changedAt: Date.parse('2026-09-29T04:28:28.769Z') })
    expect(a['mission-control.vbs']).toEqual({ enabled: true, changedAt: null })
  })
  it('treats 06/07 style values by the low bit', () => {
    const a = parseStartupApproved('    x.lnk    REG_BINARY    070000000000000000000000\r\n    y.lnk    REG_BINARY    060000000000000000000000')
    expect(a['x.lnk'].enabled).toBe(false)
    expect(a['y.lnk'].enabled).toBe(true)
  })
})

describe('findBotStartupEntries', () => {
  const bot = 'C:\\Users\\H\\claudecode\\discord-household-bot'
  it('matches files that launch the bot folder, case-insensitively', () => {
    const files = [
      { name: 'start-household-bot.vbs', text: 'WshShell.Run """C:\\users\\h\\claudecode\\Discord-Household-Bot\\start_bot.bat""", 0' },
      { name: 'mission-control.vbs', text: 'WshShell.Run "wscript.exe ""C:\\Users\\H\\claudecode\\mission-control\\launch.vbs"""' },
      { name: 'desktop.ini', text: bot }
    ]
    expect(findBotStartupEntries(files, bot)).toEqual(['start-household-bot.vbs'])
  })
})

describe('startupVerdict', () => {
  const approved = parseStartupApproved(REG)
  it('fails when the only entry is switched off, with when', () => {
    expect(startupVerdict(['start-household-bot.vbs'], approved))
      .toEqual({ status: 'fail', reason: 'disabled', entry: { name: 'start-household-bot.vbs', enabled: false, changedAt: Date.parse('2026-09-29T04:28:28.769Z') } })
  })
  it('ok when any entry is on; never-toggled counts as on', () => {
    expect(startupVerdict(['start-household-bot.vbs', 'start-household-bot.bat'], approved).status).toBe('ok')
    expect(startupVerdict(['new-entry.vbs'], approved)).toEqual({ status: 'ok', entry: { name: 'new-entry.vbs', enabled: true, changedAt: null } })
  })
  it('fails when nothing launches the bot', () => {
    expect(startupVerdict([], approved)).toEqual({ status: 'fail', reason: 'missing' })
  })
})

describe('activityVerdict', () => {
  const t = { botActivityWarnH: 12, botActivityFailH: 48 }
  it('ok when recent', () => expect(activityVerdict(0, 2 * H, t)).toBe('ok'))
  it('warn after 12h', () => expect(activityVerdict(0, 13 * H, t)).toBe('warn'))
  it('fail after 48h', () => expect(activityVerdict(0, 49 * H, t)).toBe('fail'))
  it('unknown when no log time', () => expect(activityVerdict(null, 1, t)).toBe('unknown'))
})
