import { describe, it, expect } from 'vitest'
import { nvapp, driverVerdict } from '../src/main/nvidia.js'
import { pcChecks } from '../src/main/checks/pc.js'

const rpc = (result) => async () => ({ ok: true, status: 200, json: { jsonrpc: '2.0', id: 1, result } })

const STATUS = {
  installedDriver: { version: '610.88', channel: 'GAME_READY' },
  preferredChannel: 'GAME_READY',
  recommendedDrivers: [{ version: '617.42', channel: 'GAME_READY', releaseDate: '2026-10-06', isUpdateAvailable: true }]
}

describe('nvapp', () => {
  it('returns structuredContent and sends a tools/call', async () => {
    let sent
    const http = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return rpc({ structuredContent: { running: false } })() }
    expect(await nvapp(http, 'nvapp_overlay_get_current_game_info')).toEqual({ ok: true, data: { running: false } })
    expect(sent.url).toBe('http://127.0.0.1:13508/mcp')
    expect(sent.body).toMatchObject({ method: 'tools/call', params: { name: 'nvapp_overlay_get_current_game_info', arguments: {} } })
  })
  it('offline when the app is not listening', async () => {
    const r = await nvapp(async () => ({ ok: false, status: 0, error: 'ECONNREFUSED' }), 'x')
    expect(r).toMatchObject({ ok: false, code: 'offline' })
  })
  it('surfaces tool errors with their code', async () => {
    const r = await nvapp(rpc({ isError: true, content: [{ type: 'text', text: 'Not found' }], _meta: { error_code: 'game_not_found' } }), 'x')
    expect(r).toEqual({ ok: false, code: 'game_not_found', error: 'Not found' })
  })
})

describe('driverVerdict', () => {
  it('warns when an update on the preferred channel exists', () => {
    const v = driverVerdict(STATUS)
    expect(v.status).toBe('warn')
    expect(v.summary).toMatch(/^610\.88 → 617\.42 available/)
  })
  it('ok when current', () => {
    const v = driverVerdict({ ...STATUS, recommendedDrivers: [{ ...STATUS.recommendedDrivers[0], isUpdateAvailable: false }] })
    expect(v).toEqual({ status: 'ok', summary: '610.88 game ready · up to date' })
  })
  it('ignores updates on another channel', () => {
    const v = driverVerdict({ ...STATUS, recommendedDrivers: [{ ...STATUS.recommendedDrivers[0], channel: 'STUDIO' }] })
    expect(v.status).toBe('ok')
  })
  it('unknown without an installed driver', () => expect(driverVerdict({}).status).toBe('unknown'))
})

describe('pc.driver check', () => {
  const check = pcChecks.find((c) => c.id === 'pc.driver')
  const ctx = (http) => ({ http, fs: { exists: () => true } })

  it('unknown when NVIDIA App is closed', async () => {
    const r = await check.run(ctx(async () => ({ ok: false, status: 0, error: 'ECONNREFUSED' })))
    expect(r).toMatchObject({ status: 'unknown', summary: 'NVIDIA App not running' })
  })
  it('attaches release notes and an Open NVIDIA App shortcut when behind', async () => {
    const http = async (url, opts) => {
      const name = JSON.parse(opts.body).params.name
      return rpc({ structuredContent: name === 'nvapp_client_get_driver_status' ? STATUS : { version: '617.42', highlights: [] } })()
    }
    const r = await check.run(ctx(http))
    expect(r.status).toBe('warn')
    expect(r.details.releaseNotes.version).toBe('617.42')
    expect(r.shortcuts[0]).toMatchObject({ kind: 'openPath', label: 'Open NVIDIA App' })
  })
})
