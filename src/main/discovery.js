// LAN device discovery: asks the network "who's there?" and reads what devices
// freely announce — mDNS/Bonjour (names, models, services), SSDP/UPnP (friendly
// names from description XML) and NetBIOS (Windows PC names). No logins, no admin.
import dgram from 'dgram'

// ---------- mDNS wire format ----------

const T = { A: 1, PTR: 12, TXT: 16, SRV: 33 }

function encodeName(name) {
  return Buffer.concat([
    ...name.split('.').map((l) => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)])),
    Buffer.from([0])
  ])
}

/** PTR query packet for the given service names (multicast responses). */
export function encodeQuery(names) {
  const h = Buffer.alloc(12)
  h.writeUInt16BE(names.length, 4)
  return Buffer.concat([h, ...names.map((n) => Buffer.concat([encodeName(n), Buffer.from([0, T.PTR, 0, 1])]))])
}

function readName(buf, off) {
  const labels = []
  let end = -1
  for (let hops = 0; hops < 64; hops++) {
    const len = buf[off]
    if (len === undefined) throw new Error('truncated')
    if (len === 0) { off++; break }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = off + 2
      off = ((len & 0x3f) << 8) | buf[off + 1]
      continue
    }
    labels.push(buf.subarray(off + 1, off + 1 + len).toString('utf8'))
    off += len + 1
  }
  return [labels.join('.'), end < 0 ? off : end]
}

/** All answer/authority/additional records: [{name, type, value}] (TXT value = string[]). */
export function parseMdns(buf) {
  const qd = buf.readUInt16BE(4)
  const rr = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10)
  let off = 12
  for (let i = 0; i < qd; i++) off = readName(buf, off)[1] + 4
  const out = []
  for (let i = 0; i < rr; i++) {
    const [name, o] = readName(buf, off)
    const type = buf.readUInt16BE(o)
    const len = buf.readUInt16BE(o + 8)
    const d = o + 10
    let value = null
    if (type === T.PTR) value = readName(buf, d)[0]
    else if (type === T.SRV) value = readName(buf, d + 6)[0]
    else if (type === T.A) value = [...buf.subarray(d, d + 4)].join('.')
    else if (type === T.TXT) {
      value = []
      for (let p = d; p < d + len; p += buf[p] + 1) if (buf[p]) value.push(buf.subarray(p + 1, p + 1 + buf[p]).toString('utf8'))
    }
    if (value !== null) out.push({ name, type, value })
    off = d + len
  }
  return out
}

// ---------- interpreting mDNS ----------

export const SERVICE_LABELS = {
  _googlecast: 'Chromecast',
  _airplay: 'AirPlay',
  _raop: 'AirPlay audio',
  '_spotify-connect': 'Spotify',
  '_amzn-wplay': 'Amazon audio',
  '_amzn-alexa': 'Alexa',
  _tidalconnect: 'Tidal',
  _ipp: 'Printing',
  _ipps: 'Printing',
  _printer: 'Printing',
  '_pdl-datastream': 'Printing',
  _uscan: 'Scanning',
  _scanner: 'Scanning',
  _smb: 'File sharing',
  '_companion-link': 'Apple device',
  _hap: 'HomeKit',
  _meshcop: 'Thread hub',
  _googlezone: 'Google Home',
  _http: 'Web page'
}

const serviceOf = (name) => /(_[a-z0-9-]+)\._(tcp|udp)\.local$/i.exec(name)?.[1]?.toLowerCase()
const instanceOf = (name) => name.replace(/\._[a-z0-9-]+\._(tcp|udp)\.local$/i, '').replace(/\._[a-z0-9-]+\._(tcp|udp)$/i, '')
const txt = (values, key) => values?.find((v) => v.toLowerCase().startsWith(key + '='))?.slice(key.length + 1) || null
// Instance names that are just ids/hashes aren't names.
const looksLikeId = (s) => /^[0-9a-f-]{12,}$/i.test(s) || /^[A-Za-z0-9+/=]{10,}$/.test(s) && !/\s/.test(s) && /\d/.test(s)

/** Collapse one device's mDNS records into {name, model, services[]}. */
export function summarizeMdns(records) {
  const services = new Set()
  let name = null, nameRank = 99, model = null
  const offer = (n, rank) => { if (n && rank < nameRank && !looksLikeId(n)) { name = n; nameRank = rank } }

  for (const r of records) {
    // "_services._dns-sd" listings are ignored: Echo/Nest hubs act as discovery
    // proxies and list every service type on the network, not just their own.
    // A device only gets a service when it answers with its own instance of it.
    if (r.name.startsWith('_services._dns-sd')) continue
    const svc = serviceOf(r.name)
    if (svc && SERVICE_LABELS[svc]) services.add(SERVICE_LABELS[svc])
    if (r.type === T.TXT) {
      if (svc === '_googlecast') { offer(txt(r.value, 'fn'), 1); model ??= txt(r.value, 'md') }
      if (svc === '_airplay') model ??= txt(r.value, 'model')
      if (svc === '_raop') model ??= txt(r.value, 'am')
      if (svc === '_ipp' || svc === '_printer') model ??= txt(r.value, 'ty')
      if (svc === '_device-info') model ??= txt(r.value, 'model')
    }
    if (r.type === T.PTR && !r.name.startsWith('_services')) {
      const inst = instanceOf(r.value).replace(/^[0-9A-F]{12}@/, '') // raop: "MAC@Name"
      const s = serviceOf(r.value)
      if (s === '_airplay' || s === '_raop') offer(inst, 2)
      else if (s === '_companion-link') offer(inst, 2)
      else if (s === '_ipp' || s === '_printer' || s === '_smb') offer(inst, 3)
      else if (s === '_meshcop') { const m = /^Google Inc\. (.+?)(?: #\w+)?$/.exec(inst); if (m) model ??= m[1] }
    }
  }
  return { name, model, services: [...services].sort() }
}

// ---------- SSDP / UPnP ----------

export function parseSsdp(text) {
  const h = (k) => new RegExp(`^${k}:\\s*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? null
  return { location: h('LOCATION'), server: h('SERVER') }
}

export function parseUpnpXml(xml) {
  const tag = (t) => new RegExp(`<${t}>([^<]*)</${t}>`, 'i').exec(xml)?.[1]?.trim() || null
  return { friendlyName: tag('friendlyName'), manufacturer: tag('manufacturer'), modelName: tag('modelName') }
}

// ---------- NetBIOS ----------

/** Computer name from `nbtstat -A <ip>` (first UNIQUE <00> entry). */
export function parseNbtstat(text) {
  const m = /^\s*([^\s<]+)\s*<00>\s+UNIQUE/m.exec(text)
  return m ? m[1] : null
}

// ---------- device type ----------

export function deviceType({ vendor = '', services = [], model = '', name = '', isGateway = false }) {
  const s = new Set(services)
  const v = vendor.toLowerCase(), m = `${model} ${name}`.toLowerCase()
  if (isGateway) return 'Router'
  if (s.has('Printing') || s.has('Scanning') || /epson|brother|canon|hp inc|hewlett|lexmark/.test(v) && !s.size) return 'Printer'
  if (/hub|display|nest hub|echo show/.test(m)) return 'Smart display'
  if (/tv|fire ?tv|roku|shield|chromecast/.test(m)) return 'TV / streamer'
  if (s.has('AirPlay audio') || s.has('Spotify') || s.has('Amazon audio') || /soundbar|speaker|sonos|echo|q\d{3}/.test(m)) return 'Speaker'
  if (s.has('Chromecast')) return 'TV / streamer'
  if (s.has('Apple device')) return 'Apple device'
  if (/intel|realtek|micro-star|asustek|dell|lenovo|gigabyte/.test(v)) return 'Computer'
  if (v.startsWith('private')) return 'Phone / tablet'
  if (/tp-link|tuya|espressif|shelly|philips|signify/.test(v)) return 'Smart home'
  if (/amazon/.test(v)) return 'Amazon device'
  if (/google/.test(v)) return 'Google device'
  return null
}

const PRIVATE_IP = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/

/** Prefer the most specific name source. */
export function bestName({ mdns, upnp, netbios }) {
  return mdns?.name || upnp?.friendlyName || netbios || null
}

// ---------- network I/O ----------

const MDNS_SERVICES = Object.keys(SERVICE_LABELS).map((s) => `${s}._${s === '_meshcop' ? 'udp' : 'tcp'}.local`)

function listenMdns(timeoutMs) {
  return new Promise((resolve) => {
    const byIp = {}
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const done = () => { try { sock.close() } catch { /* closed */ } resolve(byIp) }
    sock.on('error', done)
    sock.on('message', (buf, rinfo) => {
      try { (byIp[rinfo.address] ??= []).push(...parseMdns(buf)) } catch { /* malformed packet */ }
    })
    sock.bind(5353, () => {
      try { sock.addMembership('224.0.0.251') } catch { /* no multicast */ }
      const send = (names) => sock.send(encodeQuery(names), 5353, '224.0.0.251')
      send(['_services._dns-sd._udp.local'])
      // One question per packet: some devices ignore multi-question queries.
      MDNS_SERVICES.forEach((n, i) => setTimeout(() => send([n]), 250 * (i + 1)))
      setTimeout(done, timeoutMs)
    })
  })
}

function listenSsdp(timeoutMs) {
  return new Promise((resolve) => {
    const byIp = {}
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const done = () => { try { sock.close() } catch { /* closed */ } resolve(byIp) }
    sock.on('error', done)
    sock.on('message', (msg, rinfo) => { byIp[rinfo.address] ??= parseSsdp(msg.toString()) })
    sock.bind(() => {
      const q = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n'
      sock.send(q, 1900, '239.255.255.250')
      setTimeout(() => sock.send(q, 1900, '239.255.255.250'), 1000)
      setTimeout(done, timeoutMs)
    })
  })
}

/**
 * Discover names for the given devices. Returns { [ip]: {name, model, services, source} }.
 * `devices` = [{ip, vendor}], used to decide which hosts are worth a NetBIOS lookup.
 */
export async function discover({ devices, exec, http, timeoutMs = 9000 }) {
  const [mdnsRaw, ssdp] = await Promise.all([listenMdns(timeoutMs), listenSsdp(4000)])
  const out = {}

  for (const [ip, records] of Object.entries(mdnsRaw)) {
    const s = summarizeMdns(records)
    if (s.name || s.model || s.services.length) out[ip] = { ...s, source: 'mDNS' }
  }

  for (const [ip, { location }] of Object.entries(ssdp)) {
    let host
    try { host = new URL(location).hostname } catch { continue }
    if (host !== ip || !PRIVATE_IP.test(host)) continue // only read descriptions from the device itself
    const res = await http(location, { timeoutMs: 3000 })
    if (!res.ok || !res.text) continue
    const u = parseUpnpXml(res.text)
    const cur = out[ip] ?? { name: null, model: null, services: [], source: 'UPnP' }
    out[ip] = { ...cur, name: cur.name || u.friendlyName, model: cur.model || u.modelName, upnpMaker: u.manufacturer }
  }

  // NetBIOS only for likely Windows PCs that are still nameless.
  const pcs = devices.filter((d) => !out[d.ip]?.name && /intel|realtek|micro-star|asustek|dell|lenovo|gigabyte/i.test(d.vendor ?? ''))
  await Promise.all(pcs.slice(0, 8).map(async (d) => {
    const { stdout } = await exec('nbtstat', ['-A', d.ip], { timeoutMs: 12000 })
    const name = parseNbtstat(stdout)
    if (name) out[d.ip] = { ...(out[d.ip] ?? { model: null, services: [] }), name, source: out[d.ip]?.source ?? 'NetBIOS' }
  }))

  return out
}
