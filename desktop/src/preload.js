const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('app', {
  version: process.env.npm_package_version ?? '1.0.2',
  onUpdateAvailable: cb => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateDownloaded: cb => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
})
