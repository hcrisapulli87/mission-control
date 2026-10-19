import { nativeImage } from 'electron'

const COLORS = {
  ok: [34, 197, 94],
  warn: [245, 158, 11],
  fail: [239, 68, 68],
  unknown: [113, 113, 122]
}

const cache = new Map()

/** A filled, anti-aliased status dot drawn into a raw BGRA bitmap (no image files needed). */
export function trayIcon(status) {
  if (cache.has(status)) return cache.get(status)
  const size = 32
  const [r, g, b] = COLORS[status] ?? COLORS.unknown
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const radius = size / 2 - 3
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - d))
      const i = (y * size + x) * 4
      buf[i] = Math.round(b * alpha)
      buf[i + 1] = Math.round(g * alpha)
      buf[i + 2] = Math.round(r * alpha)
      buf[i + 3] = Math.round(255 * alpha)
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
  cache.set(status, img)
  return img
}
