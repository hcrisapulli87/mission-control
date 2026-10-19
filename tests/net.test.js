import { describe, it, expect } from 'vitest'
import { parsePing, parseGateway, parseArp, subnetHosts, speedVerdict, vendorFor, normMac, median } from '../src/main/checks/net.js'

const PING_OK = `
Pinging 1.1.1.1 with 32 bytes of data:
Reply from 1.1.1.1: bytes=32 time=5ms TTL=57

Ping statistics for 1.1.1.1:
    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 5ms, Maximum = 5ms, Average = 5ms`

const PING_TIMEOUT = `
Pinging 10.255.255.1 with 32 bytes of data:
Request timed out.

Ping statistics for 10.255.255.1:
    Packets: Sent = 1, Received = 0, Lost = 1 (100% loss),`

const PING_UNREACH = `
Pinging 192.168.0.9 with 32 bytes of data:
Reply from 192.168.0.212: Destination host unreachable.

Ping statistics for 192.168.0.9:
    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),`

describe('parsePing', () => {
  it('success with latency', () => expect(parsePing(PING_OK)).toEqual({ ok: true, ms: 5 }))
  it('timeout', () => expect(parsePing(PING_TIMEOUT)).toEqual({ ok: false, ms: null }))
  it('unreachable counts as failure', () => expect(parsePing(PING_UNREACH)).toEqual({ ok: false, ms: null }))
})

describe('parseGateway', () => {
  it('picks the lowest-metric default route', () => {
    const text = `Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.212     35
          0.0.0.0          0.0.0.0       10.0.0.1       10.0.0.5         50
===`
    expect(parseGateway(text)).toEqual({ gateway: '192.168.0.1', iface: '192.168.0.212' })
  })
  it('null when no default route', () => expect(parseGateway('Active Routes:\nNone')).toBeNull())
})

describe('parseArp', () => {
  it('keeps dynamic unicast entries', () => {
    const text = `Interface: 192.168.0.212 --- 0x9
  Internet Address      Physical Address      Type
  192.168.0.1           5c-62-8b-74-14-80     dynamic
  192.168.0.42          b0-99-d7-1f-69-60     dynamic
  192.168.0.255         ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static`
    expect(parseArp(text)).toEqual([
      { ip: '192.168.0.1', mac: '5C:62:8B:74:14:80' },
      { ip: '192.168.0.42', mac: 'B0:99:D7:1F:69:60' }
    ])
  })
})

describe('subnetHosts', () => {
  it('/24 around the gateway, excluding it and self', () => {
    const hosts = subnetHosts('192.168.0.1', '192.168.0.212')
    expect(hosts).toHaveLength(252)
    expect(hosts[0]).toBe('192.168.0.2')
    expect(hosts).not.toContain('192.168.0.212')
  })
})

describe('vendorFor', () => {
  it('looks up the OUI', () => expect(vendorFor('5C:62:8B:74:14:80')).toBe('TP-Link Systems'))
  it('flags randomised private MACs', () => expect(vendorFor('DA:A1:19:00:00:01')).toBe('Private (randomised) MAC'))
  it('unknown prefix', () => expect(vendorFor('00:00:00:00:00:01')).toMatch(/.+/))
  it('normalises dashes', () => expect(normMac('b0-99-d7-1f-69-60')).toBe('B0:99:D7:1F:69:60'))
})

describe('speedVerdict', () => {
  it('warns under half the 7-day median', () => {
    expect(median([100, 200, 300])).toBe(200)
    expect(speedVerdict(90, [200, 210, 190], 0.5)).toBe('warn')
    expect(speedVerdict(150, [200, 210, 190], 0.5)).toBe('ok')
    expect(speedVerdict(10, [], 0.5)).toBe('ok')
  })
})
