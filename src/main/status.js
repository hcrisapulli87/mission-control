export const STATUS = { OK: 'ok', WARN: 'warn', FAIL: 'fail', UNKNOWN: 'unknown' }

const RANK = { unknown: 0, ok: 1, warn: 2, fail: 3 }

export const rank = (s) => RANK[s] ?? 0

/** Worst known status in the list. `unknown` only wins when nothing else is known. */
export function worst(statuses) {
  return statuses.reduce((acc, s) => (rank(s) > rank(acc) ? s : acc), STATUS.UNKNOWN)
}

export const result = (status, summary, extra = {}) => ({ status, summary, ...extra })
export const unknown = (summary, extra) => result(STATUS.UNKNOWN, summary, extra)
