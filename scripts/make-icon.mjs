// Draws the Mission Control icon (radar scope) and writes resources/icon.ico.
// Pure Node: rasterise → PNG (zlib) → ICO with PNG entries (16–256 px).
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ])
}

const clamp = (v) => Math.max(0, Math.min(1, v))
const mix = (a, b, t) => a + (b - a) * t

function draw(size) {
  const S = 4 // supersample
  const out = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0, 0]
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size * 2 - 1
          const y = (py + (sy + 0.5) / S) / size * 2 - 1
          let col = [0, 0, 0, 0]
          // rounded-square tile
          const rr = 0.32, q = [Math.max(Math.abs(x) - (0.94 - rr), 0), Math.max(Math.abs(y) - (0.94 - rr), 0)]
          if (Math.hypot(q[0], q[1]) <= rr) {
            const g = clamp((y + 1) / 2)
            col = [mix(22, 10, g), mix(28, 14, g), mix(40, 20, g), 1]
            const r = Math.hypot(x, y)
            const ang = Math.atan2(y, x)
            // sweep wedge (trailing glow behind the beam at -45°)
            const beam = -Math.PI / 4
            let da = beam - ang
            while (da < 0) da += Math.PI * 2
            if (r < 0.7 && da < 1.4) {
              const t = (1 - da / 1.4) * 0.55
              col = [mix(col[0], 34, t), mix(col[1], 197, t), mix(col[2], 94, t), 1]
            }
            // rings
            for (const ringR of [0.7, 0.47, 0.24]) {
              const w = size <= 32 ? 0.06 : 0.03
              if (Math.abs(r - ringR) < w) col = [mix(col[0], 74, 0.8), mix(col[1], 222, 0.8), mix(col[2], 128, 0.8), 1]
            }
            // beam line
            const along = x * Math.cos(beam) + y * Math.sin(beam)
            const perp = Math.abs(-x * Math.sin(beam) + y * Math.cos(beam))
            if (along > 0 && along < 0.7 && perp < (size <= 32 ? 0.05 : 0.025)) col = [134, 239, 172, 1]
            // blips
            for (const [bx, by, br, c] of [[0.3, -0.12, 0.09, [134, 239, 172]], [-0.32, 0.3, 0.08, [251, 191, 36]], [0, 0, 0.07, [220, 252, 231]]]) {
              if (Math.hypot(x - bx, y - by) < br) col = [...c, 1]
            }
          }
          acc = acc.map((v, i) => v + col[i])
        }
      }
      const n = S * S
      const a = acc[3] / n
      const i = (py * size + px) * 4
      out[i] = a ? acc[0] / acc[3] : 0
      out[i + 1] = a ? acc[1] / acc[3] : 0
      out[i + 2] = a ? acc[2] / acc[3] : 0
      out[i + 3] = Math.round(a * 255)
    }
  }
  return out
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((s) => png(s, draw(s)))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  return e
})
mkdirSync(new URL('../resources/', import.meta.url), { recursive: true })
writeFileSync(new URL('../resources/icon.ico', import.meta.url), Buffer.concat([header, ...dir, ...pngs]))
writeFileSync(new URL('../resources/icon-256.png', import.meta.url), pngs.at(-1))
console.log('wrote resources/icon.ico')
