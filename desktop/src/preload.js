const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('app', {
  version: process.env.npm_package_version ?? '1.0.0',
})
