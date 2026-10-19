import { worst } from './status.js'

const REMIND_MS = 24 * 3_600_000

export const isMuted = (alert, now) => !!alert && (alert.muteUntilRecover || alert.mutedUntil > now)

/**
 * Pure alert policy: notify on transition INTO fail, remind once per 24h while
 * still failing, quiet "recovered" note on fail→ok. Warn/unknown never notify.
 */
export function decideAlert({ prevStatus, nextStatus, alert, now }) {
  const next = { ...alert }
  const muted = isMuted(alert, now)
  let notify = null

  if (nextStatus === 'fail') {
    if (prevStatus !== 'fail') notify = 'fail'
    else if (now - alert.lastNotifiedAt >= REMIND_MS) notify = 'remind'
  } else if (prevStatus === 'fail' && nextStatus === 'ok') {
    notify = 'recover'
    next.muteUntilRecover = false
  }

  if (muted) return { notify: null, alert: next }
  if (notify === 'fail' || notify === 'remind') next.lastNotifiedAt = now
  return { notify, alert: next }
}

/** Overall tray colour: worst status among checks that aren't muted. */
export function trayStatus(results, alerts, now) {
  return worst(results.filter((r) => !isMuted(alerts[r.id], now)).map((r) => r.status))
}
