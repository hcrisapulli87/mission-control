import { botChecks } from './bot.js'
import { codeChecks } from './code.js'
import { auditChecks } from './audit.js'
import { cloudChecks } from './cloud.js'
import { pcChecks } from './pc.js'
import { netChecks } from './net.js'

export const AREAS = [
  { id: 'bot', title: 'Discord bot' },
  { id: 'code', title: 'Code' },
  { id: 'cloud', title: 'Cloud' },
  { id: 'pc', title: 'PC' },
  { id: 'network', title: 'Network' }
]

export const allChecks = [
  ...botChecks, ...codeChecks, ...auditChecks,
  ...cloudChecks, ...pcChecks, ...netChecks
]
