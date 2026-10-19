import { AREAS } from './checks/index.js'
import { DEFAULTS } from './settings.js'

const DAY = 86_400_000

/**
 * All renderer → main calls. `app` is the object built in index.js:
 * { db, secrets, scheduler, getSettings, saveSettings, scanKeys, runShortcut, refresh }
 */
export function registerIpc(ipcMain, app) {
  const h = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args))

  h('results:get', () => ({
    areas: AREAS,
    results: app.db.getResults(),
    alerts: app.db.getAlerts(),
    now: Date.now()
  }))
  h('results:rerun', async (id) => {
    if (id) await app.scheduler.runNow(id)
    else await app.scheduler.runAll()
    return true
  })

  h('metrics:get', (checkId, sinceMs = DAY) => {
    const since = Date.now() - sinceMs
    return app.db.getMetricNames(checkId).map((name) => ({ name, points: app.db.getMetrics(checkId, name, since) }))
  })
  h('events:get', (kind, limit) => app.db.getEvents({ kind, limit }))

  h('devices:get', () => app.db.getDevices())
  h('devices:set', (mac, meta) => {
    app.db.setDeviceMeta(mac, meta)
    app.db.persist()
    return app.db.getDevices()
  })
  h('devices:markAllKnown', () => {
    for (const d of app.db.getDevices()) if (!d.known) app.db.setDeviceMeta(d.mac, { name: d.name, known: true })
    app.db.persist()
    return app.db.getDevices()
  })

  h('alerts:mute', (checkId, mode) => {
    const a = app.db.getAlert(checkId)
    const next = {
      ...a,
      mutedUntil: mode === 'day' ? Date.now() + DAY : 0,
      muteUntilRecover: mode === 'recover'
    }
    app.db.setAlert(checkId, next)
    app.db.persist()
    app.refresh()
    return next
  })

  h('settings:get', () => {
    const { secret, ...settings } = app.getSettings()
    return { settings, defaults: DEFAULTS, masked: app.secrets.masked(), startWithWindows: app.isStartWithWindows() }
  })
  h('settings:set', (partial) => {
    app.saveSettings(partial)
    return true
  })
  h('secrets:set', (key, value) => {
    app.secrets.set(key, value)
    return app.secrets.masked()
  })

  // Scan results stay in main; the renderer only sees masked values.
  let lastScan = []
  h('keys:scan', async () => {
    lastScan = await app.scanKeys()
    const masked = app.secrets.masked()
    return lastScan.map((k) => ({
      secret: k.secret, source: k.source, preview: '••••' + k.value.slice(-4), alreadySet: !!masked[k.secret]
    }))
  })
  h('keys:import', (secretNames) => {
    for (const k of lastScan) if (secretNames.includes(k.secret)) app.secrets.set(k.secret, k.value)
    lastScan = []
    return app.secrets.masked()
  })

  h('shortcut:run', (s) => app.runShortcut(s))
}
