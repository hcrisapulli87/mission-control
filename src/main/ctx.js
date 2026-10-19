// Real capabilities handed to checks. Checks only touch the outside world
// through these, which keeps every check unit-testable with fakes.
import { execFile } from 'child_process'
import { promises as fsp, existsSync } from 'fs'

export function exec(file, args = [], { timeoutMs = 25_000, cwd, maxBuffer = 20 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
        resolve({ stdout: stdout ?? '', stderr: stderr || (err && code === -1 ? err.message : '') || '', code })
      })
  })
}

export const powershell = (script, opts) =>
  exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], opts)

async function readTail(path, bytes) {
  const fh = await fsp.open(path, 'r')
  try {
    const { size } = await fh.stat()
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

export const fs = {
  exists: (p) => existsSync(p),
  readFile: (p) => fsp.readFile(p, 'utf8'),
  readTail,
  stat: (p) => fsp.stat(p),
  readdir: (p) => fsp.readdir(p, { withFileTypes: true }),
  statfs: (p) => fsp.statfs(p)
}

async function viaFetch(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000, raw = false }) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal, redirect: 'follow' })
    if (raw) {
      const buf = await res.arrayBuffer()
      return { status: res.status, ok: res.ok, bytes: buf.byteLength, ms: Date.now() - started }
    }
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, ok: res.ok, text, json, ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

/** HTTP request that never throws: network failures come back as { error }. */
export async function http(url, opts = {}) {
  try {
    return await viaFetch(url, opts)
  } catch (err) {
    return { status: 0, ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message, ms: opts.timeoutMs ?? 10_000 }
  }
}

export function makeCtxFactory({ db, getSettings, now = Date.now }) {
  return (check) => ({
    exec,
    powershell,
    fs,
    http,
    now,
    db,
    settings: getSettings(),
    store: {
      get: (k, fallback = null) => db.kvGet(`check:${check.id}:${k}`, fallback),
      set: (k, v) => db.kvSet(`check:${check.id}:${k}`, v)
    }
  })
}
