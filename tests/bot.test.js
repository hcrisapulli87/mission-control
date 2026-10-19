import { describe, it, expect } from 'vitest'
import {
  parseTasklist, parseLogTime, lastLogTime, countExits, findAuthError, activityVerdict
} from '../src/main/checks/bot.js'

const H = 3_600_000
const local = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime()

describe('parseTasklist', () => {
  it('counts pythonw processes', () => {
    const csv = '"pythonw.exe","1234","Console","1","12,000 K"\r\n"pythonw.exe","5678","Console","1","40,000 K"\r\n'
    expect(parseTasklist(csv)).toBe(2)
  })
  it('none running', () => {
    expect(parseTasklist('INFO: No tasks are running which match the specified criteria.')).toBe(0)
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

describe('findAuthError', () => {
  it('finds auth errors after the most recent start', () => {
    const text = launcher + '\r\n[Mon 19/10/2026 09:12:03.00] starting bot \r\n    self.service = self._authenticate()\r\nRefreshError: invalid_grant'
    expect(findAuthError(text, local(2026, 10, 19, 9, 30), H)).toMatch(/invalid_grant|_authenticate|RefreshError/)
  })
  it('ignores old errors once a later start ran clean', () => {
    const text = launcher + '\r\n[Mon 19/10/2026 09:12:03.00] starting bot \r\n[2026-10-19 09:12:05] [INFO    ] discord.client: logging in'
    expect(findAuthError(text, local(2026, 10, 19, 9, 30), H)).toBeNull()
  })
  it('ignores errors older than the window', () => {
    const text = '[Mon 19/10/2026 01:00:00.00] starting bot \r\nRefreshError: invalid_grant'
    expect(findAuthError(text, local(2026, 10, 19, 9, 30), H)).toBeNull()
  })
})

describe('activityVerdict', () => {
  const t = { botActivityWarnH: 12, botActivityFailH: 48 }
  it('ok when recent', () => expect(activityVerdict(0, 2 * H, t)).toBe('ok'))
  it('warn after 12h', () => expect(activityVerdict(0, 13 * H, t)).toBe('warn'))
  it('fail after 48h', () => expect(activityVerdict(0, 49 * H, t)).toBe('fail'))
  it('unknown when no log time', () => expect(activityVerdict(null, 1, t)).toBe('unknown'))
})
