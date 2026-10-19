# Mission Control — Design

**Date:** 2026-10-19
**Status:** Approved
**Folder:** `claudecode/mission-control/` (own git repo)

## Purpose

One always-on desktop dashboard that watches everything Harrison runs: the Discord
household bot and its Google tokens, the code in `claudecode/`, hosted services
(Vercel, Supabase, API keys), PC health, and the home network. It exists because
failures in these places are silent — e.g. on 2026-10-19 the bot was found dead
since 2026-09-29 (Google token refresh failure → crash loop → never restarted).

Electron only for v1. A phone PWA may come later; the design keeps that cheap
(see "Future: PWA").

## Stack

electron-vite + React 18 + Tailwind 3 + zustand + sql.js + vitest — same as
`chordvault/`. Dark theme. Launched via `launch.vbs` (hidden-window `npm start`),
with a desktop `.lnk` and a branded `.ico`.

## Architecture

### Process model

- **Tray app.** Electron main process owns a `Tray` icon whose colour reflects the
  worst current status (green ok / amber warn / red fail / grey if everything is
  unknown). Clicking opens the dashboard window. Closing the window hides it; "Quit"
  lives in the tray menu.
- **Start with Windows.** A toggle in Settings writes/removes a `.vbs` in the
  user's Startup folder that runs the app's `launch.vbs` (same pattern as the bot).
- **Single instance.** `app.requestSingleInstanceLock()`; a second launch focuses
  the existing window.

### Check modules

Each check is a self-contained module:

```js
export default {
  id: 'bot.process',          // unique, dotted area.name
  area: 'bot',                // bot | code | cloud | pc | network
  title: 'Bot process',
  intervalMs: 60_000,
  run: async (ctx) => ({
    status: 'ok' | 'warn' | 'fail' | 'unknown',
    summary: 'one line',
    details: { ... },         // free-form JSON rendered by the detail panel
    metrics: { name: number },// optional; appended to history for charts
    shortcuts: [ { kind, label, ... } ],
  }),
}
```

`ctx` provides injected capabilities so checks are unit-testable with fakes:

- `ctx.exec(file, args, opts)` → `{ stdout, stderr, code }` (execFile, never a shell string)
- `ctx.fs` — readFile, readTail(path, bytes), stat, readdir, exists
- `ctx.http(url, opts)` → `{ status, json?, text?, ms }` (Node fetch in main; falls back to curl if fetch is unavailable)
- `ctx.settings` — resolved settings (thresholds, paths, decrypted secrets)
- `ctx.store` — check-scoped key/value + access to devices/token-hash tables
- `ctx.now()` — clock

Most checks are split into a pure **parser/evaluator** (tested directly) and a thin
`run` that gathers input via `ctx`.

### Statuses

- `ok`, `warn`, `fail` — evaluated against thresholds.
- `unknown` — not configured (e.g. no Vercel token) or the check itself errored/timed
  out. Grey, never alerts, never affects the tray colour except when everything is unknown.

### Scheduler

- Each check runs on its own interval; first run staggered over ~10s at startup.
- 30s timeout per run (speed test: 90s). Max 4 checks in flight.
- A throwing or timed-out check yields `unknown` with the error message; the scheduler never dies.
- Network failures inside a check back off (interval × 2, capped at 4× normal) until a success.
- Manual re-run from the UI bypasses the interval (internal action, safe).
- After each scheduler tick that produced results: write results → **persist the
  sql.js DB once** (never export per write — known sql.js `last_insert_rowid` reset
  gotcha; inserts read ids via `INSERT … RETURNING id`).

## v1 Checks

### Bot + Google tokens

Bot path default: `claudecode/discord-household-bot`.

| id | Source | Rule |
|---|---|---|
| `bot.process` | `tasklist /FI "IMAGENAME eq pythonw.exe" /FO CSV /NH` | none running → fail |
| `bot.activity` | timestamp of last line in `logs/bot.log` (tail 64KB) | >12h warn, >48h fail |
| `bot.crashloop` | tail 256KB of `logs/launcher.log`, count `bot exited` lines in last 60 min | >3 → fail |
| `bot.auth` | same tail, last 60 min of lines after the latest `starting bot`: `invalid_grant`, `RefreshError`, or `_authenticate` | found → fail "Google token dead — re-auth" |
| `google.tokens` | each `token_*.json`: SHA-256 of `refresh_token` | see below |

**Token countdown.** Google refresh tokens for an OAuth app in "Testing" mode die 7
days after issue. The file's `expiry` field is the 1-hour access token, so it is not
used. Instead Mission Control stores `(file, sha256(refresh_token), first_seen)`; when
the hash changes, `first_seen` resets. Days left = 7 − age. ≤2 days warn, ≤0 fail.
Only the hash is stored, never the token. A Settings toggle "OAuth app is in Testing
mode" (default on) disables the countdown once the app is published. If the first
sighting is the baseline, the summary says "age unknown before <date>" and status is ok.

Launcher timestamps are `[Tue 29/09/2026 21:13:43.84]` (AU `dd/mm/yyyy`); bot.log
lines are `2026-09-29 19:01:10,001 [INFO] …`. Both parsers are unit-tested.

Shortcuts: open bot folder, open `logs/launcher.log`, copy restart command
`Stop-Process -Name pythonw -Force` (only useful while the loop is running) and
copy start command (path to `launch_hidden.vbs`).

### Code health

Root default: `claudecode/`. Scans immediate subfolders (plus the root itself),
minus a Settings ignore list (default: `node_modules`, `docs`, `memory`,
`.claude`, `.superpowers`, `.playwright-mcp`, `everafter-redesign-extract`).
A folder is a "project" if it has `package.json`, `*.py`, or `.git`.

One check per concern, each producing a per-repo table in `details`:

| id | Rule |
|---|---|
| `code.nogit` | project folder with no `.git` → warn |
| `code.dirty` | `git status --porcelain` non-empty → warn (count of files) |
| `code.noremote` | no `origin` remote → warn |
| `code.unpushed` | `git rev-list --count @{u}..HEAD` > 0 → warn; branch without upstream counts as unpushed |
| `code.branches` | local branches not merged into `main`/`master` → warn; any with last commit >14 days → listed as stale |
| `code.audit` | daily `npm audit --json` per repo with `package-lock.json`: moderate → warn, high/critical → fail |

`git fetch --quiet` runs per repo with an `origin` every 6h (separate interval, part
of `code.unpushed`). Interval for the rest: 10 min. Overall check status = worst repo.

Shortcuts per repo: open folder, open in VS Code (`code <path>`), open terminal
(`wt -d <path>`), copy `git push`.

### Cloud

Secrets (Vercel token, Supabase personal access token, API keys) are entered in
Settings or imported (below).

| id | Source | Rule |
|---|---|---|
| `cloud.vercel` | `GET https://api.vercel.com/v9/projects` then latest production deployment per project (`/v6/deployments?projectId=…&target=production&limit=1`) | `ERROR`/`CANCELED` → fail; `BUILDING` older than 30 min → warn |
| `cloud.uptime` | GET each production URL (from Vercel project aliases), every 5 min | non-2xx/3xx or timeout (10s) → fail; >3s → warn; latency recorded as metric |
| `cloud.supabase` | `GET https://api.supabase.com/v1/projects` (status) and `POST /v1/projects/{ref}/database/query` with `select pg_database_size(current_database())` | status not `ACTIVE_HEALTHY` (incl. `INACTIVE` = paused) → fail; DB ≥70% of 500 MB → warn, ≥90% → fail |
| `cloud.apikeys` | daily validity call per configured key | invalid (401/403) → fail; network error → unknown |

API key testers (v1): TMDB (`/3/configuration`), IGDB (Twitch client-credentials
token endpoint), eBay (`getRateLimits` — reports real remaining quota; <10% warn),
Pokémon TCG (`/v2/sets?pageSize=1` with `X-Api-Key`), SteamGridDB (`/api/v2/grids/game/1` style auth probe; 401 = invalid).

**Import from apps.** A Settings button scans `claudecode/*/.env`, `.env.local`,
and `%APPDATA%/<app>/*.json` config files for known variable names
(`TMDB_API_KEY`, `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`, `EBAY_*`,
`POKEMON_TCG_API_KEY`, `STEAMGRIDDB_API_KEY`, and `VITE_`-prefixed variants), shows
what it found (masked), and imports on confirm. Values are copied once into Mission
Control's encrypted settings — no ongoing dependency on other apps' files.

Shortcuts: open Vercel project dashboard, open Supabase project dashboard, open site.

### PC

| id | Source | Rule |
|---|---|---|
| `pc.gpu` | `nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits` every 1 min | ≥80°C warn, ≥88°C fail; `nvidia-smi` missing → unknown |
| `pc.cpu` | `os.cpus()` delta between runs, every 1 min | ≥90% for 10 consecutive samples → warn |
| `pc.ram` | `os.totalmem/freemem` every 1 min | ≥90% for 10 samples → warn |
| `pc.disks` | `fs.statfs` per fixed drive letter (from `Get-CimInstance Win32_LogicalDisk -Filter DriveType=3`), plus `Get-PhysicalDisk` HealthStatus; every 15 min | free <15% warn, <5% fail; HealthStatus ≠ Healthy → fail |
| `pc.restart` | registry `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired` and `…\Component Based Servicing\RebootPending` exist (`reg query`), `os.uptime()`; every 1h | reboot pending → warn; uptime >14 days → warn |

Metrics recorded: gpu temp/util, cpu %, ram %, free % per disk.
CPU temperature and SMART wear are out of scope (need admin — verified).

### Network

| id | Source | Rule |
|---|---|---|
| `net.internet` | `ping -n 1 -w 1000` to 1.1.1.1 and 8.8.8.8 every 1 min | both fail → fail and open an outage event; first success closes it with duration |
| `net.gateway` | default gateway from `route print 0.0.0.0` / `ipconfig`; ping it every 1 min | unreachable → fail |
| `net.speed` | Cloudflare: download `https://speed.cloudflare.com/__down?bytes=25000000`, upload 10 MB to `https://speed.cloudflare.com/__up`, every 6h; skipped (status kept) if latest GPU util ≥80% | <50% of 7-day median download → warn; metrics: down/up Mbps |
| `net.devices` | ping sweep of the gateway's /24 (concurrency 32, 500ms timeout) then `arp -a`; every 30 min | any device not marked known → warn |

Devices table: MAC, last IP, vendor (bundled offline OUI prefix map), user name,
known flag, first/last seen. Marking known / naming happens in the detail panel.
Outage list (start, end, duration) shown in the detail panel.

## UI

- **Dashboard.** Top banner: overall status + counts. Five area cards (Bot, Code,
  Cloud, PC, Network). Each row: status dot, title, one-line summary, "checked 2m
  ago", ↻ re-run, shortcut buttons, mute menu.
- **Detail panel** (click a row): `details` rendered per check type — history chart
  (simple SVG line, last 24h/7d) for metric checks, outage list, device table, repo
  table, token table.
- **Settings.** Root folder, bot folder, secrets (masked, with Import from apps),
  thresholds and intervals (defaults pre-filled — nothing required), ignore list,
  start-with-Windows, OAuth testing-mode toggle.
- Everything works with zero configuration: unconfigured cloud checks show grey
  "not configured — add token in Settings".

### Shortcuts (never execute changes)

Kinds: `openPath` (Explorer), `openUrl`, `openInCode`, `openTerminal`, `copy`
(clipboard). Main validates every shortcut: paths must exist; URLs must be
`https:`; commands are copied, never run.

## Alerts

- Windows notification (Electron `Notification`) only on transition **into `fail`**
  from any other status. Warn changes the tray colour only.
- Still failing → one reminder per 24h.
- Recovery (fail → ok) gives a quiet notification "✓ <check> recovered".
- Per-check mute: 1 day or until recovers. Muted checks still show status, no alerts,
  and do not affect the tray colour.

## Data

sql.js DB at `%APPDATA%/mission-control/mission-control.sqlite`.

- `results(check_id PK, status, summary, details_json, shortcuts_json, checked_at, error)`
- `metrics(id, check_id, name, value, ts)` — pruned to 30 days daily
- `events(id, kind, check_id, from_status, to_status, data_json, ts)` — transitions, outages
- `devices(mac PK, ip, vendor, name, known, first_seen, last_seen)`
- `token_hashes(file PK, hash, first_seen)`
- `alerts(check_id PK, last_notified_at, muted_until, mute_until_recover)`
- `kv(key PK, value)` — settings (non-secret) and check scratch state

Secrets live in a separate `secrets.json` in userData, each value encrypted with
Electron `safeStorage` (DPAPI). Never logged, never sent to the renderer in clear
(renderer only sees masked values / "set" flags).

## Error handling

- Check throws / times out → `unknown` + error text; scheduler continues.
- External commands via `execFile` with argument arrays built in code; no shell
  string, no user/web text interpolated.
- Corrupt DB at startup → rename to `.corrupt-<ts>` and start fresh (results
  rebuild within minutes; only history is lost).
- Missing tools (`nvidia-smi`, `git`, `npm`) → that check is `unknown` with a clear message.

## Testing

Vitest, no real network/processes. Unit tests for: tasklist CSV, bot.log and
launcher.log timestamp parsing, crash-loop counting, auth-error detection, token
countdown, git porcelain / rev-list / branch parsing, npm audit JSON, Vercel and
Supabase response evaluation, nvidia-smi CSV, disk thresholds, sustained-CPU rule,
ping and `arp -a` parsing, gateway parsing, OUI lookup, speed-test median rule,
scheduler (timeout → unknown, backoff), alert dedupe/remind/mute/recover, env-key
import scanner, shortcut validation.

## Out of scope (v1)

PWA / Supabase publishing, Discord alerts, executing actions, CPU temp / SMART
detail, GitHub API, Windows Update counts, `npm outdated`.

## Future: PWA

Add one "publisher" that upserts `results` rows to a Supabase table after each tick.
A phone PWA reads that table. No check code changes.
