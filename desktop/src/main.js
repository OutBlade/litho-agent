const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')
const path = require('path')

// ── Auto-updater ──────────────────────────────────────────────────────────────
autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.allowPrerelease = false
// Required for unsigned builds: skip Authenticode check, rely on sha512 in latest.yml
autoUpdater.verifyUpdateCodeSignature = false

let mainWindow = null

autoUpdater.on('update-available', info => {
  log.info('[updater] Update available:', info.version)
  mainWindow?.webContents.send('update-available', { version: info.version })
})

autoUpdater.on('update-downloaded', info => {
  log.info('[updater] Downloaded:', info.version)
  mainWindow?.webContents.send('update-downloaded', { version: info.version })
  // Auto-install after 8 s if the user does nothing
  setTimeout(() => {
    try { autoUpdater.quitAndInstall(false, true) } catch (e) { log.error(e) }
  }, 8000)
})

autoUpdater.on('error', err => log.error('[updater]', err.message))

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 920,
    minHeight: 600,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: '#0e0e10',
    title: 'LithoAgent',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  Menu.setApplicationMenu(null)
  mainWindow.loadFile(path.join(__dirname, 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    // Delay check so startup feels instant
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
    // Re-check every 15 minutes for long sessions
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 15 * 60 * 1000)
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('app:install-update', () => autoUpdater.quitAndInstall(false, true))
ipcMain.handle('app:version', () => app.getVersion())

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
