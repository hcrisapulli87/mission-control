import { describe, it, expect } from 'vitest'
import { parseNvidiaSmi, cpuPercent, pushSample, sustained, parseJsonList, diskVerdict, gpuVerdict } from '../src/main/checks/pc.js'

describe('parseNvidiaSmi', () => {
  it('parses the csv row', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 3080, 45, 3, 1200, 10240\r\n')).toEqual({
      name: 'NVIDIA GeForce RTX 3080', temp: 45, util: 3, memUsed: 1200, memTotal: 10240
    })
  })
  it('null for junk', () => expect(parseNvidiaSmi('')).toBeNull())
})

describe('gpuVerdict', () => {
  it('thresholds', () => {
    const t = { gpuWarn: 80, gpuFail: 88 }
    expect(gpuVerdict(70, t)).toBe('ok')
    expect(gpuVerdict(80, t)).toBe('warn')
    expect(gpuVerdict(88, t)).toBe('fail')
  })
})

describe('cpuPercent', () => {
  it('busy share of the delta', () => {
    const prev = [{ times: { user: 100, nice: 0, sys: 0, idle: 900, irq: 0 } }]
    const curr = [{ times: { user: 400, nice: 0, sys: 100, idle: 1500, irq: 0 } }]
    // delta busy 400, delta total 1000
    expect(cpuPercent(prev, curr)).toBe(40)
  })
})

describe('sustained', () => {
  it('true only when last n samples all exceed', () => {
    let s = []
    for (let i = 0; i < 9; i++) s = pushSample(s, 95, 10)
    expect(sustained(s, 90, 10)).toBe(false)
    s = pushSample(s, 95, 10)
    expect(sustained(s, 90, 10)).toBe(true)
    s = pushSample(s, 50, 10)
    expect(sustained(s, 90, 10)).toBe(false)
    expect(s).toHaveLength(10)
  })
})

describe('parseJsonList', () => {
  it('normalises single object and arrays', () => {
    expect(parseJsonList('{"a":1}')).toEqual([{ a: 1 }])
    expect(parseJsonList('[{"a":1},{"a":2}]')).toHaveLength(2)
    expect(parseJsonList('')).toEqual([])
  })
})

describe('diskVerdict', () => {
  it('free space thresholds', () => {
    const t = { diskWarnPct: 15, diskFailPct: 5 }
    expect(diskVerdict(50, t)).toBe('ok')
    expect(diskVerdict(14, t)).toBe('warn')
    expect(diskVerdict(4, t)).toBe('fail')
  })
})
