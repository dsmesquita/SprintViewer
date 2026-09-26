import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'
import { openInBrowser } from './handlers/links'
import { registerIpc } from './ipc'
import { primeSettings, trustedHostsSync } from './storage'

/**
 * Main process. Owns everything the renderer must not touch: the window, outbound links,
 * the PAT, the TFS client, and the sprint files on disk.
 */

const isDev = !app.isPackaged

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f3',
    title: 'Sprint Viewer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // Work item links open in the real browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openInBrowser(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) void window.loadURL(devServerUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

/**
 * A second window showing a snapshot, read-only, so it can sit beside the live board and be
 * compared with it. Same renderer bundle; the query string is what tells it which to be.
 */
export function openSnapshotWindow(sprintId: string, snapshotId: string): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f3',
    title: 'Sprint Viewer — snapshot',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openInBrowser(url)
    return { action: 'deny' }
  })

  const query = `snapshot=${encodeURIComponent(snapshotId)}&sprint=${encodeURIComponent(sprintId)}`
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) void window.loadURL(`${devServerUrl}?${query}`)
  else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
  }
}

/**
 * On-prem servers are often fronted by an internal CA that Windows trusts and Chromium does
 * not. Rather than turning verification off, the user names the one host they trust in
 * Settings and only that host's failures are overridden.
 */
function installCertificatePolicy(): void {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode !== 0 && trustedHostsSync().includes(request.hostname)) {
      callback(0)
      return
    }
    callback(-3) // Defer to Chromium's own verdict.
  })
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.sprintviewer.app')
  await primeSettings()
  installCertificatePolicy()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
