# Mission Control

A system-tray dashboard that watches everything Harrison runs: the Discord household
bot (and whether it will start with Windows), every project in `claudecode/`, Vercel/Supabase/API keys,
PC health, and the home network. Windows notification when something **starts**
failing; a reminder once a day while it stays broken.

Design: [docs/design.md](docs/design.md) · Plan: [docs/plan.md](docs/plan.md)

## Run

- Double-click the **Mission Control** desktop shortcut (runs `launch.vbs` → hidden `npm start`).
- Settings → **Start with Windows** puts a launcher in the Startup folder. Launched at
  logon it stays in the tray; launched by hand it opens the dashboard.
- Closing the window hides it. Quit from the tray icon's menu.

## How it works

```
scheduler (main) ──run(ctx)──▶ check modules ──▶ { status, summary, details, metrics, shortcuts }
      │                                                 │
      └── batch of results ──▶ sql.js (persist once) ──▶ alerts ──▶ tray colour + notifications
                                                     └──▶ IPC ──▶ React dashboard
```

- Each check (`src/main/checks/*.js`) is a small module with an interval. Pure parsers
  are exported and unit-tested; `run(ctx)` only touches the world through
  `ctx.exec / fs / http / store`.
- Status `unknown` = not configured or the check itself failed. Grey, never alerts.
- Shortcuts only *open* things (folder, VS Code, terminal, dashboard URL, copy a
  command); nothing is ever executed on your behalf.
- Secrets live in `%APPDATA%/mission-control/secrets.json`, each value encrypted with
  Windows DPAPI (Electron `safeStorage`). The UI only ever sees masked values.

## Checks

| Area | Checks |
|---|---|
| Discord bot | process running, log activity, crash loop, startup entry still enabled in Windows Startup apps |
| Code | projects without git, uncommitted changes, no remote, unpushed work, unmerged/stale branches, `npm audit --omit=dev` |
| Cloud | Vercel production deploys, site uptime + latency, Supabase status + DB size vs 500 MB, API key validity (eBay quota) |
| PC | GPU temp/load (nvidia-smi), GPU driver update + release notes (NVIDIA App), CPU, RAM, disk space + health, pending restart / long uptime |
| Network | internet + outage log, router, Cloudflare speed test (skipped while a game runs or the GPU is busy), devices on the LAN |

CPU temperature and SMART wear need admin rights and are deliberately left out.

## Develop

```bash
npm install
npm test        # vitest, no network
npm start       # electron-vite dev
```

- `node scripts/make-icon.mjs` regenerates `resources/icon.ico`.
- `scripts/make-oui.mjs` rebuilds the MAC-vendor table from the IEEE registry (see header comment).

## NVIDIA App

`src/main/nvidia.js` talks to the NVIDIA App's own local MCP server
(`http://127.0.0.1:13508/mcp`, plain JSON-RPC `tools/call`, localhost only). With the
NVIDIA App closed, the driver check goes grey and the speed test falls back to GPU load.
