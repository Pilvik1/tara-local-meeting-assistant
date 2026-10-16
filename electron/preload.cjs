const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tara', {
  platform: process.platform,
  saveAudio: (input) => ipcRenderer.invoke('tara:save-audio', input),
})
