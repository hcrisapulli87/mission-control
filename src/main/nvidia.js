// Client for the NVIDIA App's local MCP server (ships with NVIDIA App, listens on
// localhost only). It speaks JSON-RPC over plain HTTP and answers tools/call
// without a session handshake, so one POST per call is enough.
export const NVAPP_URL = 'http://127.0.0.1:13508/mcp'
export const NVAPP_EXE = 'C:\\Program Files\\NVIDIA Corporation\\NVIDIA App\\CEF\\NVIDIA App.exe'

/**
 * Call one NVIDIA App tool through the never-throwing ctx.http.
 * Resolves { ok: true, data } with the tool's structuredContent, or
 * { ok: false, error, code } — `code` is 'offline' when the app isn't running.
 */
export async function nvapp(http, tool, args = {}) {
  const res = await http(NVAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
    timeoutMs: 8_000
  })
  if (!res.ok || !res.json) return { ok: false, code: 'offline', error: res.error ?? `HTTP ${res.status}` }
  const r = res.json.result
  if (!r) return { ok: false, code: 'rpc', error: res.json.error?.message ?? 'No result' }
  if (r.isError) return { ok: false, code: r._meta?.error_code ?? 'tool', error: r.content?.[0]?.text ?? 'Tool error' }
  return { ok: true, data: r.structuredContent ?? null }
}

const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

/** Turn nvapp_client_get_driver_status into a check verdict. */
export function driverVerdict(s) {
  const installed = s?.installedDriver?.version
  if (!installed) return { status: 'unknown', summary: 'No NVIDIA driver reported' }
  const update = (s.recommendedDrivers ?? []).find((d) => d.isUpdateAvailable && d.channel === (s.preferredChannel ?? d.channel))
  const channel = (s.installedDriver.channel ?? '').replace('_', ' ').toLowerCase()
  if (!update) return { status: 'ok', summary: `${installed} ${channel} · up to date` }
  return {
    status: 'warn',
    summary: `${installed} → ${update.version} available (released ${fmtDate(update.releaseDate)})`,
    update
  }
}
