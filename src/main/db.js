// sql.js persistence. Callers batch writes and call persist() once per scheduler
// tick — never export per write (db.export() resets last_insert_rowid, and
// serialising the whole DB per row is wasteful). Inserted ids come from RETURNING.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS results (
  check_id TEXT PRIMARY KEY, area TEXT, title TEXT, status TEXT, summary TEXT,
  details_json TEXT, shortcuts_json TEXT, checked_at INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT, check_id TEXT, name TEXT, value REAL, ts INTEGER
);
CREATE INDEX IF NOT EXISTS metrics_lookup ON metrics (check_id, name, ts);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, check_id TEXT,
  from_status TEXT, to_status TEXT, data_json TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS devices (
  mac TEXT PRIMARY KEY, ip TEXT, vendor TEXT, name TEXT, known INTEGER DEFAULT 0,
  first_seen INTEGER, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS token_hashes (file TEXT PRIMARY KEY, hash TEXT, first_seen INTEGER);
CREATE TABLE IF NOT EXISTS alerts (
  check_id TEXT PRIMARY KEY, last_notified_at INTEGER, muted_until INTEGER, mute_until_recover INTEGER
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
`

const parse = (s, fallback) => {
  if (s == null) return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

export function openDb({ SQL, load, save, onCorrupt }) {
  let db
  const bytes = load()
  try {
    db = bytes ? new SQL.Database(bytes) : new SQL.Database()
    db.exec(SCHEMA)
  } catch (err) {
    onCorrupt?.(err)
    db = new SQL.Database()
    db.exec(SCHEMA)
  }

  const all = (sql, params = []) => {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  }
  const one = (sql, params) => all(sql, params)[0] ?? null
  const run = (sql, params = []) => db.run(sql, params)

  const toEvent = (r) => ({
    id: r.id, kind: r.kind, checkId: r.check_id, from: r.from_status, to: r.to_status,
    data: parse(r.data_json, null), ts: r.ts
  })

  const api = {
    saveResult(r) {
      run(
        `INSERT INTO results VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(check_id) DO UPDATE SET area=excluded.area, title=excluded.title,
           status=excluded.status, summary=excluded.summary, details_json=excluded.details_json,
           shortcuts_json=excluded.shortcuts_json, checked_at=excluded.checked_at, error=excluded.error`,
        [r.id, r.area, r.title, r.status, r.summary ?? '', JSON.stringify(r.details ?? {}),
          JSON.stringify(r.shortcuts ?? []), r.checkedAt, r.error ?? null]
      )
    },
    getResults() {
      return all('SELECT * FROM results ORDER BY check_id').map((r) => ({
        id: r.check_id, area: r.area, title: r.title, status: r.status, summary: r.summary,
        details: parse(r.details_json, {}), shortcuts: parse(r.shortcuts_json, []),
        checkedAt: r.checked_at, error: r.error
      }))
    },

    addMetric(checkId, name, value, ts) {
      run('INSERT INTO metrics (check_id, name, value, ts) VALUES (?,?,?,?)', [checkId, name, value, ts])
    },
    getMetricNames(checkId) {
      return all('SELECT DISTINCT name FROM metrics WHERE check_id=? ORDER BY name', [checkId]).map((r) => r.name)
    },
    getMetrics(checkId, name, sinceTs) {
      return all('SELECT value, ts FROM metrics WHERE check_id=? AND name=? AND ts>=? ORDER BY ts',
        [checkId, name, sinceTs])
    },

    addEvent({ kind, checkId = null, from = null, to = null, data = null, ts }) {
      return one(
        `INSERT INTO events (kind, check_id, from_status, to_status, data_json, ts)
         VALUES (?,?,?,?,?,?) RETURNING id`,
        [kind, checkId, from, to, data == null ? null : JSON.stringify(data), ts]
      ).id
    },
    getEvents({ kind, limit = 100 } = {}) {
      const rows = kind
        ? all('SELECT * FROM events WHERE kind=? ORDER BY id DESC LIMIT ?', [kind, limit])
        : all('SELECT * FROM events ORDER BY id DESC LIMIT ?', [limit])
      return rows.map(toEvent)
    },

    getOpenOutage() {
      const r = one(`SELECT * FROM events WHERE kind='outage' AND json_extract(data_json,'$.end') IS NULL
                     ORDER BY id DESC LIMIT 1`)
      return r ? toEvent(r) : null
    },
    openOutage(ts) {
      if (api.getOpenOutage()) return
      api.addEvent({ kind: 'outage', data: { start: ts, end: null }, ts })
    },
    closeOutage(ts) {
      const o = api.getOpenOutage()
      if (!o) return null
      const data = { start: o.data.start, end: ts, durationMs: ts - o.data.start }
      run('UPDATE events SET data_json=? WHERE id=?', [JSON.stringify(data), o.id])
      return data
    },

    upsertDevice({ mac, ip, vendor, ts }) {
      run(
        `INSERT INTO devices (mac, ip, vendor, name, known, first_seen, last_seen) VALUES (?,?,?,NULL,0,?,?)
         ON CONFLICT(mac) DO UPDATE SET ip=excluded.ip, vendor=excluded.vendor, last_seen=excluded.last_seen`,
        [mac, ip, vendor, ts, ts]
      )
    },
    getDevices() {
      return all('SELECT * FROM devices ORDER BY last_seen DESC').map((d) => ({
        mac: d.mac, ip: d.ip, vendor: d.vendor, name: d.name, known: !!d.known,
        firstSeen: d.first_seen, lastSeen: d.last_seen
      }))
    },
    setDeviceMeta(mac, { name, known }) {
      run('UPDATE devices SET name=?, known=? WHERE mac=?', [name || null, known ? 1 : 0, mac])
    },

    getTokenHash(file) {
      const r = one('SELECT hash, first_seen FROM token_hashes WHERE file=?', [file])
      return r ? { hash: r.hash, firstSeen: r.first_seen } : null
    },
    setTokenHash(file, hash, firstSeen) {
      run('INSERT OR REPLACE INTO token_hashes VALUES (?,?,?)', [file, hash, firstSeen])
    },

    getAlert(checkId) {
      const r = one('SELECT * FROM alerts WHERE check_id=?', [checkId])
      return {
        lastNotifiedAt: r?.last_notified_at ?? 0,
        mutedUntil: r?.muted_until ?? 0,
        muteUntilRecover: !!r?.mute_until_recover
      }
    },
    getAlerts() {
      const out = {}
      for (const r of all('SELECT check_id FROM alerts')) out[r.check_id] = api.getAlert(r.check_id)
      return out
    },
    setAlert(checkId, { lastNotifiedAt, mutedUntil, muteUntilRecover }) {
      run('INSERT OR REPLACE INTO alerts VALUES (?,?,?,?)',
        [checkId, lastNotifiedAt, mutedUntil, muteUntilRecover ? 1 : 0])
    },

    kvGet(key, fallback = null) {
      const r = one('SELECT value FROM kv WHERE key=?', [key])
      return r ? parse(r.value, fallback) : fallback
    },
    kvSet(key, value) {
      run('INSERT OR REPLACE INTO kv VALUES (?,?)', [key, JSON.stringify(value)])
    },

    prune(beforeTs) {
      run('DELETE FROM metrics WHERE ts < ?', [beforeTs])
      run(`DELETE FROM events WHERE ts < ? AND NOT (kind='outage' AND json_extract(data_json,'$.end') IS NULL)`, [beforeTs])
    },

    persist() { save(db.export()) }
  }
  return api
}
