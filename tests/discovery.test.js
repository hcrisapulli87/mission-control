import { describe, it, expect } from 'vitest'
import {
  encodeQuery, parseMdns, summarizeMdns, parseSsdp, parseUpnpXml, parseNbtstat, deviceType, bestName
} from '../src/main/discovery.js'

// Minimal mDNS response builder (no compression) for tests.
const name = (n) => Buffer.concat([...n.split('.').map((l) => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)])), Buffer.from([0])])
function rr(n, type, data) {
  const h = Buffer.alloc(10)
  h.writeUInt16BE(type, 0); h.writeUInt16BE(1, 2); h.writeUInt32BE(120, 4); h.writeUInt16BE(data.length, 8)
  return Buffer.concat([name(n), h, data])
}
const txtData = (items) => Buffer.concat(items.map((s) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)])))
const srvData = (target) => Buffer.concat([Buffer.from([0, 0, 0, 0, 0x1f, 0x49]), name(target)])
function packet(records) {
  const h = Buffer.alloc(12)
  h.writeUInt16BE(0x8400, 2); h.writeUInt16BE(records.length, 6)
  return Buffer.concat([h, ...records])
}

const nestHub = packet([
  rr('_googlecast._tcp.local', 12, name('Google-Nest-Hub-Max-f34591cb._googlecast._tcp.local')),
  rr('Google-Nest-Hub-Max-f34591cb._googlecast._tcp.local', 16, txtData(['id=f34591cb', 'md=Google Nest Hub Max', 'fn=Kitchen Display'])),
  rr('Google-Nest-Hub-Max-f34591cb._googlecast._tcp.local', 33, srvData('fuchsia-1c53.local')),
  rr('_meshcop._udp.local', 12, name('Google Inc. Google Nest Hub Max #D6C8._meshcop._udp.local'))
])

const soundbar = packet([
  rr('_airplay._tcp.local', 12, name('Q-Series Soundbar._airplay._tcp.local')),
  rr('Q-Series Soundbar._airplay._tcp.local', 16, txtData(['model=HW-Q990C'])),
  rr('_raop._tcp.local', 12, name('B099D71F6960@Q-Series Soundbar._raop._tcp.local')),
  rr('_spotify-connect._tcp.local', 12, name('Q42zC7x/G8VtP._spotify-connect._tcp.local')),
  rr('Samsung.local', 1, Buffer.from([192, 168, 0, 42]))
])

const echo = packet([
  rr('_services._dns-sd._udp.local', 12, name('_spotify-connect._tcp.local')),
  rr('_services._dns-sd._udp.local', 12, name('_amzn-wplay._tcp.local')),
  rr('_spotify-connect._tcp.local', 12, name('771d6c283a68685d._spotify-connect._tcp.local'))
])

describe('mDNS wire format', () => {
  it('encodes a PTR query', () => {
    const q = encodeQuery(['_googlecast._tcp.local'])
    expect(q.readUInt16BE(4)).toBe(1)
    expect(q.subarray(12).toString('latin1')).toContain('_googlecast')
    expect(q.subarray(-4)).toEqual(Buffer.from([0, 12, 0, 1]))
  })
  it('parses PTR, TXT, SRV and A records', () => {
    const recs = parseMdns(nestHub)
    expect(recs.find((r) => r.type === 16).value).toContain('fn=Kitchen Display')
    expect(recs.find((r) => r.type === 33).value).toBe('fuchsia-1c53.local')
    expect(parseMdns(soundbar).find((r) => r.type === 1).value).toBe('192.168.0.42')
  })
  it('follows name compression pointers', () => {
    // answer name points back at offset 12 (the first record's name)
    const first = rr('Box._http._tcp.local', 16, txtData(['a=1']))
    const ptrRec = Buffer.concat([Buffer.from([0xc0, 12]), (() => { const h = Buffer.alloc(10); h.writeUInt16BE(16, 0); h.writeUInt16BE(1, 2); h.writeUInt16BE(4, 8); return h })(), txtData(['b=2'])])
    const recs = parseMdns(packet([first, ptrRec]))
    expect(recs[1].name).toBe('Box._http._tcp.local')
    expect(recs[1].value).toEqual(['b=2'])
  })
})

describe('summarizeMdns', () => {
  it('Cast friendly name and model', () => {
    expect(summarizeMdns(parseMdns(nestHub))).toEqual({ name: 'Kitchen Display', model: 'Google Nest Hub Max', services: ['Chromecast', 'Thread hub'] })
  })
  it('AirPlay name, strips MAC@ prefix, ignores hash instance names', () => {
    expect(summarizeMdns(parseMdns(soundbar))).toEqual({ name: 'Q-Series Soundbar', model: 'HW-Q990C', services: ['AirPlay', 'AirPlay audio', 'Spotify'] })
  })
  it('ignores network-wide _services listings from proxy hubs', () => {
    const proxy = packet(['_ipp._tcp.local', '_googlecast._tcp.local', '_airplay._tcp.local'].map((s) => rr('_services._dns-sd._udp.local', 12, name(s))))
    expect(summarizeMdns(parseMdns(proxy))).toEqual({ name: null, model: null, services: [] })
  })
  it('services only, no name', () => {
    expect(summarizeMdns(parseMdns(echo))).toEqual({ name: null, model: null, services: ['Spotify'] })
  })
})

describe('SSDP / UPnP / NetBIOS', () => {
  it('parses M-SEARCH responses', () => {
    expect(parseSsdp('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.0.1:1900/rootDesc.xml\r\nSERVER: TP-LINK/TP-LINK UPnP/1.1\r\n\r\n'))
      .toEqual({ location: 'http://192.168.0.1:1900/rootDesc.xml', server: 'TP-LINK/TP-LINK UPnP/1.1' })
  })
  it('reads description XML', () => {
    expect(parseUpnpXml('<root><device><friendlyName>Archer AXE75</friendlyName><manufacturer>TP-Link</manufacturer><modelName>Archer AXE75</modelName></device></root>'))
      .toEqual({ friendlyName: 'Archer AXE75', manufacturer: 'TP-Link', modelName: 'Archer AXE75' })
  })
  it('reads the computer name from nbtstat', () => {
    const out = `Wi-Fi:\r\n    NetBIOS Remote Machine Name Table\r\n\r\n       Name               Type         Status\r\n    ---------------------------------------------\r\n    LPT-BD-HARRISON<00>  UNIQUE      Registered\r\n    WORKGROUP      <00>  GROUP       Registered\r\n`
    expect(parseNbtstat(out)).toBe('LPT-BD-HARRISON')
    expect(parseNbtstat('Host not found.')).toBeNull()
  })
})

describe('deviceType / bestName', () => {
  it('classifies', () => {
    expect(deviceType({ isGateway: true })).toBe('Router')
    expect(deviceType({ services: ['Printing', 'Scanning'] })).toBe('Printer')
    expect(deviceType({ model: 'Google Nest Hub Max', services: ['Chromecast'] })).toBe('Smart display')
    expect(deviceType({ model: 'HW-Q990C', name: 'Q-Series Soundbar', services: ['AirPlay audio'] })).toBe('Speaker')
    expect(deviceType({ vendor: 'Amazon', services: ['Amazon audio', 'Spotify'] })).toBe('Speaker')
    expect(deviceType({ vendor: 'Intel Corporate' })).toBe('Computer')
    expect(deviceType({ vendor: 'Private (randomised) MAC' })).toBe('Phone / tablet')
    expect(deviceType({ vendor: 'TP-Link Systems' })).toBe('Smart home')
    expect(deviceType({ vendor: 'Amazon' })).toBe('Amazon device')
    expect(deviceType({ vendor: 'Unknown vendor' })).toBeNull()
  })
  it('prefers mDNS, then UPnP, then NetBIOS', () => {
    expect(bestName({ mdns: { name: 'A' }, upnp: { friendlyName: 'B' }, netbios: 'C' })).toBe('A')
    expect(bestName({ upnp: { friendlyName: 'B' }, netbios: 'C' })).toBe('B')
    expect(bestName({ netbios: 'C' })).toBe('C')
  })
})
