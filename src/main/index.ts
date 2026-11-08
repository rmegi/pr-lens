import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import path from 'node:path'
import type { ChangedFile, ReviewRequest, SettingsUpdate } from '@shared/types'
import { fixPath, findExecutable } from './env'
import { compare, fetchAll, filePair, listBranches, resolveRepo } from './git'
import { addRecentRepo, getSettings, saveSettings } from './settings'
import { cancelReview, startReview } from './ai/review'

fixPath()

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'PR Lens',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win?.show())

  // Never navigate the app window away; open links in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function applyTheme() {
  nativeTheme.themeSource = getSettings().theme
}

function registerIpc() {
  ipcMain.handle('repo:pick', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Open a git repository',
      properties: ['openDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('repo:open', async (_e, p: string) => {
    const repo = await resolveRepo(p)
    addRecentRepo(repo)
    return listBranches(repo)
  })

  ipcMain.handle('repo:fetch', async (_e, repo: string) => {
    await fetchAll(repo)
    return listBranches(repo)
  })

  ipcMain.handle('repo:compare', (_e, repo: string, base: string, head: string, ignoreWs: boolean) =>
    compare(repo, base, head, ignoreWs)
  )

  ipcMain.handle('repo:filePair', (_e, repo: string, mergeBase: string, head: string, file: ChangedFile) =>
    filePair(repo, mergeBase, head, file)
  )

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, u: SettingsUpdate) => {
    const s = saveSettings(u)
    applyTheme()
    return s
  })

  ipcMain.handle('claude:available', () => Boolean(findExecutable('claude')))

  ipcMain.handle('review:start', (e, req: ReviewRequest) => {
    const sender = e.sender
    startReview(req, (ev) => {
      if (!sender.isDestroyed()) sender.send('review:event', ev)
    })
  })
  ipcMain.handle('review:cancel', (_e, id: string) => cancelReview(id))
}

app.whenReady().then(() => {
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'"
          ]
        }
      })
    })
  }
  if (process.platform === 'darwin') app.setName('PR Lens')
  applyTheme()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
