// Shortcuts open the place where a fix happens; they never perform the fix.
import { execFile, spawn } from 'child_process'
import { join } from 'path'

const PATH_KINDS = ['openPath', 'openInCode', 'openTerminal']
const PRIVATE_IP = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

/**
 * The .cmd that opens Claude Code in `cwd` pointed at the report file. Only our
 * own fixed text and validated paths go in here; the report body (which contains
 * log text) stays in the .md file and is never interpreted by cmd.exe.
 */
export function claudeLauncher(cwd, reportPath) {
  return [
    '@echo off',
    `cd /d "${cwd}"`,
    'echo Mission Control -^> Claude Code',
    `claude "Read the Mission Control report at ${reportPath} and help me fix it. Ask before changing anything."`,
    ''
  ].join('\r\n')
}

export function validateShortcut(s, exists) {
  if (!s || typeof s !== 'object') return { ok: false, error: 'Invalid shortcut' }
  if (PATH_KINDS.includes(s.kind)) {
    return typeof s.path === 'string' && exists(s.path) ? { ok: true } : { ok: false, error: `Path not found: ${s.path}` }
  }
  if (s.kind === 'openUrl') {
    try {
      const u = new URL(s.url)
      if (u.protocol === 'https:') return { ok: true }
      // Router admin pages are plain http, but only ever on the local network.
      if (u.protocol === 'http:' && PRIVATE_IP.test(u.hostname)) return { ok: true }
      return { ok: false, error: 'Only https links (or http to a LAN address) are allowed' }
    } catch {
      return { ok: false, error: 'Invalid URL' }
    }
  }
  if (s.kind === 'copy') return typeof s.text === 'string' && s.text ? { ok: true } : { ok: false, error: 'Nothing to copy' }
  if (s.kind === 'askClaude') {
    if (typeof s.prompt !== 'string' || !s.prompt || s.prompt.length > 50_000) return { ok: false, error: 'Invalid prompt' }
    return typeof s.path === 'string' && exists(s.path) ? { ok: true } : { ok: false, error: `Path not found: ${s.path}` }
  }
  return { ok: false, error: `Unknown shortcut kind: ${s.kind}` }
}

export async function runShortcut(s, { shell, clipboard, exists, requestsDir, writeFile }) {
  const v = validateShortcut(s, exists)
  if (!v.ok) return v
  switch (s.kind) {
    case 'openPath': {
      const err = await shell.openPath(s.path)
      return err ? { ok: false, error: err } : { ok: true }
    }
    case 'openUrl':
      await shell.openExternal(s.url)
      return { ok: true }
    case 'copy':
      clipboard.writeText(s.text)
      return { ok: true, message: 'Copied' }
    case 'openInCode':
      // `code` is a .cmd shim, so it goes through cmd.exe; the path is a validated existing folder.
      execFile('cmd.exe', ['/c', 'code', s.path], { windowsHide: true })
      return { ok: true }
    case 'openTerminal': {
      const child = spawn('wt.exe', ['-d', s.path], { detached: true, stdio: 'ignore' })
      child.on('error', () => spawn('cmd.exe', ['/k'], { cwd: s.path, detached: true, stdio: 'ignore' }).unref())
      child.unref()
      return { ok: true }
    }
    case 'askClaude': {
      const stamp = Date.now()
      const reportPath = join(requestsDir, `report-${stamp}.md`)
      const cmdPath = join(requestsDir, `open-${stamp}.cmd`)
      writeFile(reportPath, s.prompt)
      writeFile(cmdPath, claudeLauncher(s.path, reportPath))
      const child = spawn('wt.exe', ['cmd', '/k', cmdPath], { detached: true, stdio: 'ignore' })
      // No Windows Terminal: a detached cmd.exe gets its own console window.
      child.on('error', () => spawn('cmd.exe', ['/k', cmdPath], { detached: true, stdio: 'ignore' }).unref())
      child.unref()
      return { ok: true, message: 'Opening Claude Code…' }
    }
  }
  return { ok: false, error: 'Unhandled shortcut' }
}
