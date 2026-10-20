import { result, unknown } from '../status.js'
import { fmtDuration } from '../format.js'
import OUI from '../oui.json'
import { deviceType } from '../discovery.js'
import { nvapp } from '../nvidia.js'

export function parsePing(text) {
  const recv = /Received = (\d+)/.exec(text)
  const ok = !!recv && Number(recv[1]) > 0 && !/unreachable|General failure|transmit failed/i.test(text)
  if (!ok) return { ok: false, ms: null }
  const avg = /Average = (\d+)ms/.exec(text) ?? /time[=<](\d+)ms/.exec(text)
  return { ok: true, ms: avg ? Number(avg[1]) : null }
}

/** Default route with the lowest metric from `route print -4 0.0.0.0`. */
export function parseGateway(text) {
  const routes = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/.exec(line)
    if (m) routes.push({ gateway: m[1], iface: m[2], metric: Number(m[3]) })
  }
  if (!routes.length) return null
  const best = routes.sort((a, b) => a.metric - b.metric)[0]
  return { gateway: best.gateway, iface: best.iface }
}

export const normMac = (mac) => mac.replace(/-/g, ':').toUpperCase()

export function parseArp(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+dynamic/i.exec(line)
    if (!m) continue
    const mac = normMac(m[2])
    if (mac === 'FF:FF:FF:FF:FF:FF' || mac.startsWith('01:00:5E')) continue
    out.push({ ip: m[1], mac })
  }
  return out
}

export function subnetHosts(gateway, self) {
  const base = gateway.split('.').slice(0, 3).join('.')
  const out = []
  for (let i = 1; i < 255; i++) {
    const ip = `${base}.${i}`
    if (ip !== gateway && ip !== self) out.push(ip)
  }
  return out
}

export function vendorFor(mac) {
  const first = parseInt(mac.slice(0, 2), 16)
  if (first & 0b10) return 'Private (randomised) MAC' // locally-administered bit
  return OUI[mac.replace(/:/g, '').slice(0, 6)] ?? 'Unknown vendor'
}

/**
 * Combine this scan's discovery with what we knew. A device that answered gets
 * its services replaced (so stale/wrong lists clear) but keeps a previously
 * found name/model if it didn't repeat them. A quiet device keeps everything.
 */
export function mergeDiscovery(prev, found) {
  const keep = {
    discName: prev?.discName ?? null, model: prev?.model ?? null,
    services: prev?.services?.length ? prev.services : null, source: prev?.source ?? null
  }
  if (!found) return keep
  return {
    discName: found.name ?? keep.discName,
    model: found.model ?? keep.model,
    services: found.services ?? [],
    source: found.source ?? keep.source
  }
}

export function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function speedVerdict(down, history, ratio) {
  const med = median(history)
  return med != null && down < med * ratio ? 'warn' : 'ok'
}

const ping = async (ctx, host, timeoutMs = 1000) =>
  parsePing((await ctx.exec('ping', ['-n', '1', '-w', String(timeoutMs), host], { timeoutMs: timeoutMs + 3000 })).stdout)

async function gatewayInfo(ctx) {
  return parseGateway((await ctx.exec('route', ['print', '-4', '0.0.0.0'])).stdout)
}

async function pool(items, n, fn) {
  const queue = [...items]
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()) }))
}

const DAY = 86_400_000
const SPEED_DOWN = 'https://speed.cloudflare.com/__down?bytes=25000000'
const SPEED_UP = 'https://speed.cloudflare.com/__up'

export const netChecks = [
  {
    id: 'net.internet', area: 'network', title: 'Internet', intervalMs: 60_000,
    async run(ctx) {
      const [a, b] = await Promise.all([ping(ctx, '1.1.1.1'), ping(ctx, '8.8.8.8')])
      const now = ctx.now()
      if (!a.ok && !b.ok) {
        ctx.db.openOutage(now)
        const o = ctx.db.getOpenOutage()
        return result('fail', `Offline for ${fmtDuration(now - o.data.start)}`, { details: { outageSince: o.data.start } })
      }
      const closed = ctx.db.closeOutage(now)
      const ms = a.ms ?? b.ms
      const outages = ctx.db.getEvents({ kind: 'outage', limit: 20 }).map((e) => e.data)
      const lastWeek = outages.filter((o) => o.end && o.end > now - 7 * DAY)
      return result('ok', `Online · ${ms ?? '?'} ms` + (lastWeek.length ? ` · ${lastWeek.length} outage${lastWeek.length > 1 ? 's' : ''} this week` : ''), {
        details: { outages, justRecovered: closed }, metrics: ms != null ? { ms } : undefined
      })
    }
  },
  {
    id: 'net.gateway', area: 'network', title: 'Router', intervalMs: 60_000,
    async run(ctx) {
      const gw = await gatewayInfo(ctx)
      if (!gw) return unknown('No default route')
      const p = await ping(ctx, gw.gateway)
      return p.ok
        ? result('ok', `${gw.gateway} · ${p.ms ?? '<1'} ms`, { details: gw })
        : result('fail', `Router ${gw.gateway} not responding`, { details: gw })
    }
  },
  {
    id: 'net.speed', area: 'network', title: 'Speed test', intervalMs: 6 * 3_600_000, timeoutMs: 90_000,
    async run(ctx) {
      const t = ctx.settings.thresholds
      const gpu = ctx.db.getMetrics('pc.gpu', 'util', ctx.now() - 5 * 60_000).at(-1)
      // A game can be light on the GPU (League, Roblox) and still lag from a speed
      // test, so NVIDIA App's "game running" counts as busy too.
      const game = await nvapp(ctx.http, 'nvapp_overlay_get_current_game_info')
      const busy = game.ok && game.data?.running ? `${game.data.name ?? 'a game'} running`
        : gpu && gpu.value >= t.speedSkipGpuUtil ? `GPU busy (${gpu.value}%)` : null
      if (busy) {
        const prev = ctx.store.get('last', null)
        return result(prev?.status ?? 'unknown', `Skipped — ${busy}` + (prev ? ` · last ${prev.down} ↓ / ${prev.up} ↑ Mbps` : ''))
      }
      const down = await ctx.http(SPEED_DOWN, { raw: true, timeoutMs: 60_000 })
      if (!down.ok) return unknown(`Speed test failed: ${down.error ?? down.status}`, { networkError: true })
      const up = await ctx.http(SPEED_UP, { method: 'POST', body: Buffer.alloc(10_000_000), raw: true, timeoutMs: 60_000 })
      const mbps = (bytes, ms) => Math.round((bytes * 8) / (ms * 1000))
      const downMbps = mbps(down.bytes, down.ms)
      const upMbps = up.ok ? mbps(10_000_000, up.ms) : null
      const history = ctx.db.getMetrics('net.speed', 'down', ctx.now() - 7 * DAY).map((m) => m.value)
      const status = speedVerdict(downMbps, history, t.speedWarnRatio)
      ctx.store.set('last', { status, down: downMbps, up: upMbps })
      const med = median(history)
      return result(status, `${downMbps} ↓ / ${upMbps ?? '?'} ↑ Mbps` + (med ? ` (7-day median ${Math.round(med)} ↓)` : ''), {
        metrics: { down: downMbps, ...(upMbps != null ? { up: upMbps } : {}) }
      })
    }
  },
  {
    id: 'net.devices', area: 'network', title: 'Devices on network', intervalMs: 30 * 60_000, timeoutMs: 120_000,
    async run(ctx) {
      const gw = await gatewayInfo(ctx)
      if (!gw) return unknown('No default route')
      // Ping sweep fills the ARP cache; replies themselves don't matter.
      await pool(subnetHosts(gw.gateway, gw.iface), 32, (ip) => ping(ctx, ip, 500))
      const seen = parseArp((await ctx.exec('arp', ['-a', '-N', gw.iface])).stdout)
        .map((d) => ({ ...d, vendor: vendorFor(d.mac) }))
      // Names/models/services from what devices announce (mDNS, UPnP, NetBIOS).
      let found = {}
      try { found = await ctx.discover(seen) } catch { /* discovery is best-effort */ }
      const now = ctx.now()
      const prev = new Map(ctx.db.getDevices().map((x) => [x.mac, x]))
      for (const d of seen) {
        const m = mergeDiscovery(prev.get(d.mac), found[d.ip])
        const type = deviceType({ vendor: d.vendor, services: m.services ?? [], model: m.model ?? '', name: m.discName ?? '', isGateway: d.ip === gw.gateway })
        ctx.db.upsertDevice({ ...d, ts: now, ...m, type })
      }
      const all = ctx.db.getDevices()
      const unknownDevices = all.filter((d) => !d.known && d.lastSeen === now)
      const onlineCount = seen.length
      const named = all.filter((d) => d.lastSeen === now && (d.name || d.discName)).length
      const details = { devices: all, scanAt: now, gateway: gw.gateway }
      const label = (d) => (d.name || d.discName ? `${d.displayName}${d.type ? ` (${d.type})` : ''}` : d.type ? `${d.type} · ${d.vendor}` : d.vendor)
      return unknownDevices.length
        ? result('warn', `${onlineCount} online · ${unknownDevices.length} not marked known: ${[...new Set(unknownDevices.map(label))].slice(0, 3).join(', ')}`, { details })
        : result('ok', `${onlineCount} online · all known · ${named} identified by name`, { details })
    }
  }
]
