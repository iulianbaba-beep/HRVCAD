import { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// Renderer is served from app://hrvcad/ so fetch() of wasm/workers works like on the web.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const rendererDir = path.join(__dirname, '..', 'renderer')

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'HRVCAD',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.loadURL('app://hrvcad/index.html')
  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' })
}

app.whenReady().then(() => {
  protocol.handle('app', (req: Request) => {
    const { pathname } = new URL(req.url)
    const target = path.normalize(path.join(rendererDir, decodeURIComponent(pathname)))
    if (!target.startsWith(rendererDir)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(target).toString())
  })

  // The ribbon replaces the native menu; keep only the macOS app menu (Quit, Copy/Paste).
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }

  ipcMain.handle('file:open', async (_e: unknown, opts: { filters: Electron.FileFilter[] }) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: opts.filters })
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    const data = await fs.readFile(p)
    return { name: path.basename(p), path: p, data: new Uint8Array(data) }
  })

  ipcMain.handle('file:save', async (_e: unknown, opts: { suggestedName: string; filters: Electron.FileFilter[]; data: Uint8Array; path?: string }) => {
    let p: string | undefined = opts.path
    if (!p) {
      const r = await dialog.showSaveDialog({ defaultPath: opts.suggestedName, filters: opts.filters })
      if (r.canceled || !r.filePath) return null
      p = r.filePath as string
    }
    await fs.writeFile(p as string, opts.data)
    return { name: path.basename(p as string), path: p }
  })

  ipcMain.handle('print:pdf', async (_e: unknown, opts: { html: string; suggestedName: string; landscape: boolean }) => {
    const r = await dialog.showSaveDialog({ defaultPath: opts.suggestedName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (r.canceled || !r.filePath) return null
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
    const tmp = path.join(app.getPath('temp'), `hrvcad-report-${Date.now()}.html`)
    await fs.writeFile(tmp, opts.html, 'utf8')
    await win.loadFile(tmp)
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', landscape: opts.landscape, printBackground: true, margins: { marginType: 'default' } })
    win.destroy()
    await fs.rm(tmp, { force: true })
    await fs.writeFile(r.filePath, pdf)
    return { name: path.basename(r.filePath), path: r.filePath }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
