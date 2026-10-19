import { homedir } from 'os'
import { join } from 'path'

const ROOT = join(homedir(), 'Documents', 'claudecode')

export const DEFAULTS = {
  paths: {
    root: ROOT,
    bot: join(ROOT, 'discord-household-bot')
  },
  ignore: ['node_modules', 'docs', 'memory', '.claude', '.superpowers', '.playwright-mcp',
    'everafter-redesign-extract', 'mission-control-data'],
  oauthTesting: true,
  startWithWindows: false,
  vercelTeamId: '',
  vercelTeamId: '',
  thresholds: {
    botActivityWarnH: 12,
    botActivityFailH: 48,
    crashLoopExits: 3,
    tokenWarnDays: 2,
    staleBranchDays: 14,
    gpuWarn: 80,
    gpuFail: 88,
    cpuWarn: 90,
    ramWarn: 90,
    sustainedSamples: 10,
    diskWarnPct: 15,
    diskFailPct: 5,
    uptimeWarnDays: 14,
    latencyWarnMs: 3000,
    supabaseWarnPct: 70,
    supabaseFailPct: 90,
    supabaseLimitMb: 500,
    speedWarnRatio: 0.5,
    speedSkipGpuUtil: 80
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

function merge(base, over) {
  if (!isObj(over)) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v
  return out
}

/** Settings = defaults ⊕ user overrides (kv), plus read access to decrypted secrets. */
export function resolveSettings(overrides, secrets) {
  return { ...merge(DEFAULTS, overrides), secret: (k) => secrets.get(k) }
}
