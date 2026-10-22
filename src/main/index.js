import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, clipboard, safeStorage } from 'electron'
import { join } from 'path'
import os from 'os'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import initSqlJs from 'sql.js'
import { electronApp, is } from '@electron-toolkit/utils'

import { openDb } from './db.js'
import { createSecrets } from './secrets.js'
import { resolveSettings } from './settings.js'
import { createScheduler } from './scheduler.js'
import { makeCtxFactory, fs as ctxFs } from './ctx.js'
import { decideAlert, trayStatus } from './alerts.js'
import { allChecks } from './checks/index.js'
import { registerIpc } from './ipc.js'
import { runShortcut } from './shortcuts.js'
import { setStartWithWindows, isStartWithWindows } from './startup.js'
import { gatherSources, scanForKeys } from './envImport.js'
import { trayIcon } from './trayIcon.js'

const DAY = 86_400_000
const RETENTION = 30 * DAY

let win = null
let tray = null
let quitting = false

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => showWindow())

function createWindow({ show }) {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 900, minHeight: 600, show: false,
    backgroundColor: '#0b0d12', title: 'Mission Control', autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'resources', 'icon.ico'),
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false, contextIsolation: true }
  })
  if (show) win.once('ready-to-show', () => win.show())
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide() }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(checkId) {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (checkId) win.webContents.send('navigate', checkId)
}

async function boot() {
  electronApp.setAppUserModelId('com.mission-control')
  const userData = app.getPath('userData')
  const dbFile = join(userData, 'mission-control.sqlite')

  const SQL = await initSqlJs()
  const db = openDb({
    SQL,
    load: () => (existsSync(dbFile) ? readFileSync(dbFile) : null),
    save: (bytes) => {
      writeFileSync(dbFile + '.tmp', Buffer.from(bytes))
      renameSync(dbFile + '.tmp', dbFile)
    },
    onCorrupt: () => { if (existsSync(dbFile)) renameSync(dbFile, `${dbFile}.corrupt-${Date.now()}`) }
  })

  const secrets = createSecrets({
    file: join(userData, 'secrets.json'),
    crypto: {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
      decrypt: (b) => safeStorage.decryptString(Buffer.from(b, 'base64'))
    },
    fs: { exists: existsSync, readFile: (p) => readFileSync(p, 'utf8'), writeFile: (p, s) => writeFileSync(p, s) }
  })

  const getSettings = () => resolveSettings(db.kvGet('settings', {}), secrets)

  // "Ask Claude" briefs: our own temp files, pruned after a week.
  const requestsDir = join(userData, 'claude-requests')
  mkdirSync(requestsDir, { recursive: true })
  for (const f of readdirSync(requestsDir)) {
    const p = join(requestsDir, f)
    if (Date.now() - statSync(p).mtimeMs > 7 * DAY) unlinkSync(p)
  }
  const launchVbs = join(app.getAppPath(), 'launch.vbs')

  // Last known status per check, to detect transitions.
  // Checks removed in an update would otherwise sit on the dashboard forever, frozen.
  if (db.forgetChecksExcept(allChecks.map((c) => c.id)).length) db.persist()
  const last = new Map(db.getResults().map((r) => [r.id, r.status]))
  const titles = new Map(allChecks.map((c) => [c.id, c.title]))

  function refresh() {
    const status = trayStatus(db.getResults(), db.getAlerts(), Date.now())
    const counts = db.getResults().reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
    tray?.setImage(trayIcon(status))
    tray?.setToolTip(`Mission Control — ${counts.fail ?? 0} failing, ${counts.warn ?? 0} warnings`)
    win?.webContents.send('results:update')
  }

  function notify(kind, r) {
    if (!Notification.isSupported()) return
    const title = kind === 'recover' ? `✓ ${r.title} recovered` : `${kind === 'remind' ? 'Still failing' : 'Failing'}: ${r.title}`
    const n = new Notification({ title, body: r.summary, silent: kind === 'recover' })
    n.on('click', () => showWindow(r.id))
    n.show()
  }

  async function onTick(results) {
    const now = Date.now()
    for (const r of results) {
      const prev = last.get(r.id)
      if (prev !== r.status) db.addEvent({ kind: 'transition', checkId: r.id, from: prev ?? null, to: r.status, ts: now })
      db.saveResult(r)
      for (const [name, value] of Object.entries(r.metrics ?? {})) {
        if (Number.isFinite(value)) db.addMetric(r.id, name, value, r.checkedAt)
      }
      const decision = decideAlert({ prevStatus: prev, nextStatus: r.status, alert: db.getAlert(r.id), now })
      db.setAlert(r.id, decision.alert)
      if (decision.notify) notify(decision.notify, { ...r, title: titles.get(r.id) ?? r.title })
      last.set(r.id, r.status)
    }
    if (now - db.kvGet('lastPrune', 0) > DAY) {
      db.prune(now - RETENTION)
      db.kvSet('lastPrune', now)
    }
    db.persist()
    refresh()
  }

  const scheduler = createScheduler({ checks: allChecks, makeCtx: makeCtxFactory({ db, getSettings }), onTick })

  registerIpc(ipcMain, {
    db, secrets, scheduler, getSettings, refresh,
    isStartWithWindows: () => isStartWithWindows(app.getPath('appData')),
    saveSettings(partial) {
      const { startWithWindows, ...rest } = partial
      if (typeof startWithWindows === 'boolean') setStartWithWindows(startWithWindows, { appData: app.getPath('appData'), launchVbs })
      db.kvSet('settings', { ...db.kvGet('settings', {}), ...rest })
      db.persist()
    },
    async scanKeys() {
      const sources = await gatherSources({
        root: getSettings().paths.root,
        appData: app.getPath('appData'),
        fs: ctxFs,
        readSettingsTable: async (path) => {
          try {
            const other = new SQL.Database(readFileSync(path))
            try {
              const res = other.exec("SELECT key, value FROM settings WHERE typeof(value)='text'")[0]
              return res ? Object.fromEntries(res.values) : null
            } finally { other.close() }
          } catch { return null }
        }
      })
      return scanForKeys(sources)
    },
    runShortcut: (s) => runShortcut(s, {
      shell, clipboard, exists: existsSync, requestsDir,
      writeFile: (p, text) => writeFileSync(p, text, 'utf8')
    })
  })

  // Launched at Windows logon → stay in the tray; launched by hand → show the dashboard.
  createWindow({ show: os.uptime() > 300 })

  tray = new Tray(trayIcon('unknown'))
  tray.setToolTip('Mission Control')
  tray.on('click', () => showWindow())
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Mission Control', click: () => showWindow() },
    { label: 'Re-run all checks', click: () => scheduler.runAll() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; scheduler.stop(); db.persist(); app.quit() } }
  ]))

  refresh()
  scheduler.start()
}

app.whenReady().then(boot)

// Tray app: closing the window never quits.
app.on('window-all-closed', () => {})
app.on('before-quit', () => { quitting = true })
