// Shortcuts open the place where a fix happens; they never perform the fix.
import { execFile, spawn } from 'child_process'

const PATH_KINDS = ['openPath', 'openInCode', 'openTerminal']

export function validateShortcut(s, exists) {
  if (!s || typeof s !== 'object') return { ok: false, error: 'Invalid shortcut' }
  if (PATH_KINDS.includes(s.kind)) {
    return typeof s.path === 'string' && exists(s.path) ? { ok: true } : { ok: false, error: `Path not found: ${s.path}` }
  }
  if (s.kind === 'openUrl') {
    try {
      return new URL(s.url).protocol === 'https:' ? { ok: true } : { ok: false, error: 'Only https links are allowed' }
    } catch {
      return { ok: false, error: 'Invalid URL' }
    }
  }
  if (s.kind === 'copy') return typeof s.text === 'string' && s.text ? { ok: true } : { ok: false, error: 'Nothing to copy' }
  return { ok: false, error: `Unknown shortcut kind: ${s.kind}` }
}

export async function runShortcut(s, { shell, clipboard, exists }) {
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
      child.on('error', () => spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d "${s.path}"`], { detached: true, stdio: 'ignore' }).unref())
      child.unref()
      return { ok: true }
    }
  }
  return { ok: false, error: 'Unhandled shortcut' }
}
