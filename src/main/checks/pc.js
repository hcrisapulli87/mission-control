import os from 'os'
import { result, unknown, worst } from '../status.js'
import { fmtDuration } from '../format.js'
import { nvapp, driverVerdict, NVAPP_EXE } from '../nvidia.js'

export function parseNvidiaSmi(text) {
  const line = text.split(/\r?\n/).find((l) => l.includes(','))
  if (!line) return null
  const [name, temp, util, memUsed, memTotal] = line.split(',').map((s) => s.trim())
  const n = [temp, util, memUsed, memTotal].map(Number)
  if (n.some(Number.isNaN)) return null
  return { name, temp: n[0], util: n[1], memUsed: n[2], memTotal: n[3] }
}

export const gpuVerdict = (temp, t) => (temp >= t.gpuFail ? 'fail' : temp >= t.gpuWarn ? 'warn' : 'ok')

const sumTimes = (cpus) => cpus.reduce((acc, c) => {
  const { user, nice, sys, idle, irq } = c.times
  acc.busy += user + nice + sys + irq
  acc.total += user + nice + sys + idle + irq
  return acc
}, { busy: 0, total: 0 })

export function cpuPercent(prev, curr) {
  const a = sumTimes(prev), b = sumTimes(curr)
  const total = b.total - a.total
  return total > 0 ? Math.round(((b.busy - a.busy) / total) * 100) : 0
}

export const pushSample = (samples, v, max) => [...samples, v].slice(-max)
export const sustained = (samples, threshold, n) => samples.length >= n && samples.slice(-n).every((v) => v >= threshold)

/** PowerShell ConvertTo-Json gives an object for one item and an array for many. */
export function parseJsonList(text) {
  if (!text?.trim()) return []
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v : [v]
  } catch {
    return []
  }
}

export const diskVerdict = (freePct, t) => (freePct < t.diskFailPct ? 'fail' : freePct < t.diskWarnPct ? 'warn' : 'ok')

const REBOOT_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending'
]

// HealthStatus is an enum; stringify it in PowerShell so JSON carries "Healthy", not 0.
const PHYSICAL_DISKS_PS =
  'Get-PhysicalDisk | Select-Object FriendlyName,@{n="Health";e={"$($_.HealthStatus)"}} | ConvertTo-Json -Compress'
const LOGICAL_DISKS_PS =
  'Get-CimInstance Win32_LogicalDisk -Filter DriveType=3 | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress'

export const pcChecks = [
  {
    id: 'pc.gpu', area: 'pc', title: 'GPU', intervalMs: 60_000,
    async run(ctx) {
      const { stdout, code } = await ctx.exec('nvidia-smi',
        ['--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'])
      const g = code === 0 ? parseNvidiaSmi(stdout) : null
      if (!g) return unknown('nvidia-smi not available')
      return result(gpuVerdict(g.temp, ctx.settings.thresholds),
        `${g.temp}°C · ${g.util}% load · ${(g.memUsed / 1024).toFixed(1)}/${(g.memTotal / 1024).toFixed(0)} GB VRAM`,
        { details: g, metrics: { temp: g.temp, util: g.util } })
    }
  },
  {
    id: 'pc.driver', area: 'pc', title: 'GPU driver', intervalMs: 6 * 3_600_000,
    async run(ctx) {
      const st = await nvapp(ctx.http, 'nvapp_client_get_driver_status')
      if (!st.ok) return unknown(st.code === 'offline' ? 'NVIDIA App not running' : `NVIDIA App: ${st.error}`)
      const v = driverVerdict(st.data)
      const details = { installed: st.data.installedDriver, recommended: st.data.recommendedDrivers }
      if (v.update) {
        const notes = await nvapp(ctx.http, 'nvapp_client_get_driver_release_notes', { driver: v.update.channel })
        if (notes.ok) details.releaseNotes = notes.data
      }
      return result(v.status, v.summary, {
        details,
        shortcuts: v.update && ctx.fs.exists(NVAPP_EXE) ? [{ kind: 'openPath', label: 'Open NVIDIA App', path: NVAPP_EXE }] : []
      })
    }
  },
  {
    id: 'pc.cpu', area: 'pc', title: 'CPU', intervalMs: 60_000,
    async run(ctx) {
      const curr = os.cpus().map((c) => ({ times: c.times }))
      const prev = ctx.store.get('prev', null)
      ctx.store.set('prev', curr)
      if (!prev) return unknown('Collecting first sample…')
      const pct = cpuPercent(prev, curr)
      const t = ctx.settings.thresholds
      const samples = pushSample(ctx.store.get('samples', []), pct, t.sustainedSamples)
      ctx.store.set('samples', samples)
      const hot = sustained(samples, t.cpuWarn, t.sustainedSamples)
      return result(hot ? 'warn' : 'ok',
        `${pct}% · ${os.cpus()[0].model.trim()}${hot ? ` — ≥${t.cpuWarn}% for ${t.sustainedSamples} min` : ''}`,
        { metrics: { pct } })
    }
  },
  {
    id: 'pc.ram', area: 'pc', title: 'Memory', intervalMs: 60_000,
    async run(ctx) {
      const total = os.totalmem(), used = total - os.freemem()
      const pct = Math.round((used / total) * 100)
      const t = ctx.settings.thresholds
      const samples = pushSample(ctx.store.get('samples', []), pct, t.sustainedSamples)
      ctx.store.set('samples', samples)
      const hot = sustained(samples, t.ramWarn, t.sustainedSamples)
      return result(hot ? 'warn' : 'ok', `${pct}% · ${(used / 2 ** 30).toFixed(1)}/${(total / 2 ** 30).toFixed(0)} GB`, { metrics: { pct } })
    }
  },
  {
    id: 'pc.disks', area: 'pc', title: 'Disks', intervalMs: 15 * 60_000,
    async run(ctx) {
      const t = ctx.settings.thresholds
      const logical = parseJsonList((await ctx.powershell(LOGICAL_DISKS_PS)).stdout)
      const physical = parseJsonList((await ctx.powershell(PHYSICAL_DISKS_PS)).stdout)
      if (!logical.length) return unknown('Could not read drives')
      const drives = logical.filter((d) => d.Size > 0).map((d) => {
        const freePct = Math.round((d.FreeSpace / d.Size) * 100)
        return {
          drive: d.DeviceID, freePct, freeGb: Math.round(d.FreeSpace / 2 ** 30),
          sizeGb: Math.round(d.Size / 2 ** 30), status: diskVerdict(freePct, t)
        }
      })
      const health = physical.map((p) => ({ name: p.FriendlyName, health: p.Health, status: p.Health === 'Healthy' ? 'ok' : 'fail' }))
      const status = worst([...drives.map((d) => d.status), ...health.map((h) => h.status)])
      const unhealthy = health.filter((h) => h.status !== 'ok')
      const summary = unhealthy.length
        ? `Disk health: ${unhealthy.map((h) => `${h.name} ${h.health}`).join(', ')}`
        : drives.map((d) => `${d.drive} ${d.freeGb} GB free (${d.freePct}%)`).join(' · ')
      const metrics = Object.fromEntries(drives.map((d) => [`free_${d.drive.replace(':', '')}`, d.freePct]))
      const lowDrive = drives.find((d) => d.status !== 'ok')
      return result(status, summary, {
        details: { drives, health }, metrics,
        shortcuts: lowDrive ? [{ kind: 'openPath', label: `Open ${lowDrive.drive}`, path: `${lowDrive.drive}\\` }] : []
      })
    }
  },
  {
    id: 'pc.restart', area: 'pc', title: 'Restart & uptime', intervalMs: 60 * 60_000,
    async run(ctx) {
      const pending = []
      for (const key of REBOOT_KEYS) if ((await ctx.exec('reg', ['query', key])).code === 0) pending.push(key)
      const upMs = os.uptime() * 1000
      const longUp = upMs > ctx.settings.thresholds.uptimeWarnDays * 86_400_000
      const status = pending.length || longUp ? 'warn' : 'ok'
      const summary = pending.length
        ? `Restart pending for updates · up ${fmtDuration(upMs)}`
        : `Up ${fmtDuration(upMs)}${longUp ? ' — consider a restart' : ''}`
      return result(status, summary, { details: { pendingKeys: pending, uptimeMs: upMs } })
    }
  }
]
