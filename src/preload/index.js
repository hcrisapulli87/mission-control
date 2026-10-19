import { contextBridge, ipcRenderer } from 'electron'

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('mc', {
  getResults: call('results:get'),
  rerun: call('results:rerun'),
  getMetrics: call('metrics:get'),
  getEvents: call('events:get'),
  getDevices: call('devices:get'),
  setDevice: call('devices:set'),
  markAllKnown: call('devices:markAllKnown'),
  mute: call('alerts:mute'),
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  setSecret: call('secrets:set'),
  scanKeys: call('keys:scan'),
  importKeys: call('keys:import'),
  runShortcut: call('shortcut:run'),
  onUpdate: (fn) => {
    const listener = () => fn()
    ipcRenderer.on('results:update', listener)
    return () => ipcRenderer.removeListener('results:update', listener)
  },
  onNavigate: (fn) => {
    const listener = (_e, checkId) => fn(checkId)
    ipcRenderer.on('navigate', listener)
    return () => ipcRenderer.removeListener('navigate', listener)
  }
})
