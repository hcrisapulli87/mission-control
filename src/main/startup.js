// Start-with-Windows: a .vbs in the user's Startup folder that runs our launch.vbs
// (same pattern as the Discord bot's start-household-bot.vbs).
import { join } from 'path'
import { existsSync, writeFileSync, unlinkSync } from 'fs'

const NAME = 'mission-control.vbs'

export const startupVbs = (launchVbs) =>
  `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "wscript.exe ""${launchVbs}""", 0, False\r\nSet WshShell = Nothing\r\n`

export function startupFile(appData) {
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', NAME)
}

export function setStartWithWindows(enabled, { appData, launchVbs }) {
  const file = startupFile(appData)
  if (enabled) writeFileSync(file, startupVbs(launchVbs))
  else if (existsSync(file)) unlinkSync(file)
}

export const isStartWithWindows = (appData) => existsSync(startupFile(appData))
