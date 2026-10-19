# Mission Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Mission Control — an Electron tray app that runs scheduled health checks over the Discord bot, Google tokens, `claudecode/` repos, Vercel/Supabase/API keys, PC and home network, and alerts on failures.

**Architecture:** Electron main process hosts a scheduler that runs self-contained check modules (`{id, area, title, intervalMs, run(ctx)}`) with injected capabilities (`ctx.exec/fs/http/settings/store/now`). Pure parsers/evaluators are exported from each check file and unit-tested; results persist in sql.js (one export per tick). React renderer shows a dashboard via IPC. Spec: `docs/superpowers/specs/2026-10-19-mission-control-design.md`.

**Tech Stack:** electron-vite 2, Electron 29, React 18, Tailwind 3, zustand, sql.js, vitest. Executed inline in-session: each task = write tests → see fail → implement → see pass → commit.

---

## File structure (`mission-control/`)

```
package.json, electron.vite.config.js, vitest.config.js, tailwind.config.js,
postcss.config.js, .gitignore, launch.vbs, README.md
scripts/make-icon.mjs              # writes resources/icon.ico (pure Node PNG+ICO)
resources/icon.ico
src/main/
  index.js        bootstrap: single-instance, window, tray, scheduler wiring
  status.js       STATUS consts, worst(), rank()
  db.js           sql.js open/migrate/persist + repository functions
  secrets.js      safeStorage-encrypted secrets.json (injectable crypto)
  settings.js     DEFAULTS + resolve(kv, secrets)
  scheduler.js    createScheduler({checks, makeCtx, onResult, timers})
  alerts.js       decideAlert(prev, next, alertRow, now) (pure)
  ctx.js          real exec/fs/http/store capability builders
  shortcuts.js    validateShortcut() (pure) + runShortcut()
  startup.js      Startup-folder .vbs toggle
  trayIcon.js     coloured circle bitmap → nativeImage
  ipc.js          IPC handlers
  envImport.js    scan .env / userData json for known API key names (pure scan fn)
  oui.js          small MAC-prefix → vendor map
  checks/index.js registry (all checks)
  checks/bot.js   bot.process, bot.activity, bot.crashloop, bot.auth (+ parsers)
  checks/tokens.js google.tokens (+ countdown)
  checks/code.js  code.nogit/dirty/noremote/unpushed/branches (+ git parsers)
  checks/audit.js code.audit
  checks/pc.js    pc.gpu/cpu/ram/disks/restart
  checks/net.js   net.internet/gateway/speed/devices
  checks/cloud.js cloud.vercel/uptime/supabase/apikeys
src/preload/index.js
src/renderer/index.html
src/renderer/src/{main.jsx, App.jsx, index.css, store.js}
src/renderer/src/components/{Banner,AreaCard,CheckRow,DetailPanel,LineChart,Settings}.jsx
tests/*.test.js
```

## Tasks

### Task 1: Scaffold + status helpers
- Files: package/config files, `src/main/status.js`, `tests/status.test.js`
- Tests: `worst(['ok','warn'])==='warn'`; `worst(['unknown','ok'])==='ok'`; `worst(['unknown'])==='unknown'`; `worst([])==='unknown'`; fail beats warn.
- Commit: `chore: scaffold mission-control + status helpers`

### Task 2: DB layer (sql.js)
- Files: `src/main/db.js`, `tests/db.test.js`
- API: `openDb({file, SQL})` → `{ saveResult(r), getResults(), addMetric(checkId,name,value,ts), getMetrics(checkId,name,sinceTs), addEvent(e) → id (RETURNING), getEvents({kind,limit}), openOutage(ts)/closeOutage(ts), upsertDevice(d), getDevices(), setDeviceMeta(mac,{name,known}), getTokenHash(file)/setTokenHash(file,hash,ts), getAlert(id)/setAlert(id,row), kvGet/kvSet, prune(beforeTs), persist() }`. Corrupt file → renamed `.corrupt-<ts>`, fresh DB.
- Tests: round-trip each table in-memory; `addEvent` returns increasing ids even after `persist()`; prune deletes old metrics only; corrupt bytes → fresh DB + rename called.
- Commit: `feat: sql.js data layer`

### Task 3: Secrets + settings
- Files: `src/main/secrets.js`, `src/main/settings.js`, tests
- secrets: `createSecrets({file, crypto:{encrypt(str)→b64, decrypt(b64)→str, available()}, fs})` → `get(k)`, `set(k,v)` (empty deletes), `masked()` → `{k: '••••last4'}`. Plain values never written.
- settings: `DEFAULTS` (paths, thresholds, ignore list, oauthTesting:true, startWithWindows:false) and `resolveSettings(kvJson, secrets)`.
- Tests: encrypt used on write, file content has no plaintext; masked format; defaults merged deep with overrides.
- Commit: `feat: encrypted secrets + settings defaults`

### Task 4: Scheduler
- Files: `src/main/scheduler.js`, test
- `createScheduler({checks, makeCtx, onTick, now, setTimeout, clearTimeout, maxConcurrent=4})` → `{start(), stop(), runNow(id), status()}`. Each run wrapped with timeout (`check.timeoutMs ?? 30000`) → `{status:'unknown', summary:'Check timed out', error}`; thrown error → unknown with message. Result `{id, area, title, ...result, checkedAt}`. Backoff: result with `networkError:true` doubles next delay up to 4×. Results batched; `onTick(results[])` once per completed batch.
- Tests (fake timers via injected functions): throwing check → unknown; slow check → timeout unknown; backoff doubling and reset; runNow bypasses interval; concurrency cap.
- Commit: `feat: check scheduler with timeout + backoff`

### Task 5: Alert decisions
- Files: `src/main/alerts.js`, test
- `decideAlert({prevStatus, nextStatus, alert, now})` → `{notify: null|'fail'|'remind'|'recover', alert: newRow}`. Rules per spec: into fail → fail; still fail & last_notified ≥24h → remind; fail→ok → recover; muted (muted_until>now or mute_until_recover) → no notify; mute_until_recover cleared on recovery.
- `effectiveStatusForTray(results, alerts, now)` ignores muted checks.
- Commit: `feat: alert dedupe/remind/mute logic`

### Task 6: Real capabilities
- Files: `src/main/ctx.js`
- `exec(file,args,{timeoutMs,cwd})` via `execFile` (windowsHide, maxBuffer 20MB) never throws on non-zero → `{stdout,stderr,code}`; `fs.readTail(path,bytes)`; `http(url,{method,headers,body,timeoutMs})` → `{status, ok, text, json, ms}` with fetch + AbortController, falls back to curl on fetch failure; `makeCtx(check)` builds ctx with check-scoped `store` (kv prefix `check:<id>:`).
- No unit tests (thin I/O); exercised in Task 19 run.
- Commit: `feat: real exec/fs/http capabilities`

### Task 7: Bot checks
- Files: `src/main/checks/bot.js`, `tests/bot.test.js`
- Pure: `parseTasklist(csv)` → count; `parseBotLogTime(line)` (`2026-09-29 19:01:10,001`); `parseLauncherTime(line)` (`[Tue 29/09/2026 21:13:43.84]`); `countExits(text, now, windowMs)`; `findAuthError(text, now, windowMs)` (only lines after last `starting bot`, matching `invalid_grant|RefreshError|_authenticate`); `lastLogTime(text)`.
- Rules per spec. Shortcuts: open folder, open launcher.log, copy start command (`wscript "<bot>\launch_hidden.vbs"`).
- Tests use fixtures from real formats.
- Commit: `feat: bot health checks`

### Task 8: Google token countdown
- Files: `src/main/checks/tokens.js`, test
- Pure: `tokenCountdown({stored, hash, now, testingMode})` → `{status, daysLeft, newStored}`; first sighting = baseline ok "age unknown before <date>"; hash change resets; ≤2 warn; ≤0 fail; testingMode false → ok.
- run: reads `token_*.json`, sha256 refresh_token, stores via db token hashes.
- Commit: `feat: google token countdown`

### Task 9: Code checks
- Files: `src/main/checks/code.js`, test
- Pure: `parsePorcelain`, `parseBranches(text)` (from `git for-each-ref --format=%(refname:short)|%(committerdate:unix)|%(upstream:short) refs/heads`), `parseMerged`, `evaluateRepo(info, now)`, `discoverProjects(entries, ignore)`.
- One `scanRepos(ctx)` shared and cached per run (60s memo) so the five checks don't re-run git; each check filters its concern; fetch every 6h tracked via store.
- Commit: `feat: code health checks`

### Task 10: npm audit
- Files: `src/main/checks/audit.js`, test
- Pure: `parseAudit(json)` → `{critical,high,moderate,low}` (supports npm 7+ `metadata.vulnerabilities`). Daily interval.
- Commit: `feat: npm audit check`

### Task 11: PC checks
- Files: `src/main/checks/pc.js`, test
- Pure: `parseNvidiaSmi(csv)`, `cpuPercent(prev, curr)`, `sustained(samples, threshold, n)`, `parseLogicalDisks(json)`, `parsePhysicalDisks(json)`, `diskStatus(freePct, t)`, `rebootPending(regOutputs)`.
- Commands: powershell `Get-CimInstance Win32_LogicalDisk -Filter DriveType=3 | Select DeviceID,Size,FreeSpace | ConvertTo-Json`, `Get-PhysicalDisk | Select FriendlyName,HealthStatus | ConvertTo-Json`; `reg query`.
- Commit: `feat: PC health checks`

### Task 12: Network checks
- Files: `src/main/checks/net.js`, `src/main/oui.js`, test
- Pure: `parsePing(stdout)` → `{ok, ms}`; `parseGateway(routePrintText)`; `parseArp(text)` → `[{ip,mac}]` (dynamic only, drop broadcast/multicast); `subnetHosts(gw)`; `speedVerdict(downMbps, history)`; `vendorFor(mac)`; outage open/close logic in run via db events.
- Commit: `feat: network checks`

### Task 13: Cloud checks
- Files: `src/main/checks/cloud.js`, test
- Pure: `evalVercel(projects, deployments, now)`, `uptimeVerdict({status, ms, error})`, `evalSupabase(project, sizeBytes)`, `apiKeyTesters` table `{name, secretKeys, request(secrets) → {url, headers}, verdict(res)}` for TMDB, IGDB, eBay, Pokémon TCG, SteamGridDB.
- Not configured → unknown "not configured — add token in Settings".
- Commit: `feat: cloud checks`

### Task 14: Env import scanner
- Files: `src/main/envImport.js`, test
- Pure: `parseEnv(text)`, `KNOWN_KEYS` mapping (incl. `VITE_` variants) → secret names, `scanForKeys(files:[{path,text}])` → `[{secret, value, source}]`.
- Commit: `feat: import API keys from app env files`

### Task 15: Shortcuts, startup, IPC, preload
- Files: `src/main/shortcuts.js`, `src/main/startup.js`, `src/main/ipc.js`, `src/preload/index.js`, test for `validateShortcut`
- validate: kinds `openPath|openUrl|openInCode|openTerminal|copy`; urls must be https; paths must exist.
- IPC: `results:get`, `results:rerun`, `metrics:get`, `events:get`, `devices:get`, `devices:set`, `alerts:mute`, `settings:get`, `settings:set`, `secrets:masked`, `secrets:set`, `keys:scan`, `keys:import`, `shortcut:run`; push `results:update`.
- Commit: `feat: shortcuts, startup toggle, IPC`

### Task 16: Main bootstrap + tray
- Files: `src/main/index.js`, `src/main/trayIcon.js`
- Single-instance lock, hidden-on-close window, tray w/ colour + menu (Open, Re-run all, Quit), scheduler wiring: onTick → save results, metrics, events (transitions), decideAlert → `Notification`, persist once, push update, refresh tray. Daily prune.
- Commit: `feat: main process, tray, notifications`

### Task 17: Renderer dashboard
- Files: renderer html/main/App/store/Banner/AreaCard/CheckRow, index.css
- Commit: `feat: dashboard UI`

### Task 18: Detail panel + settings UI
- Files: DetailPanel, LineChart, Settings
- Commit: `feat: detail panel + settings`

### Task 19: Icon, launcher, desktop shortcut, run
- `scripts/make-icon.mjs` → `resources/icon.ico`; `launch.vbs`; desktop `.lnk`; README; `npm test` + `npm run build` green; launch app, confirm checks populate (bot should show fail).
- Commit: `chore: icon, launcher, README`
