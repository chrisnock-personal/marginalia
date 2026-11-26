import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import { loadConfig } from '../server/config'
import { createServer } from '../server/index'
import { findGit } from './git'
import { readSettings, settingsPath, writeSettings, type DesktopSettings } from './settings'

const execFileAsync = promisify(execFile)
const secret = randomBytes(32).toString('hex')
let launchUrl = ''
let openWindow: (() => void) | null = null

/**
 * True only when tokens would really be encrypted. On Linux without a secret
 * service Electron falls back to `basic_text`, a hard-coded key: that is no
 * better than a plain file, so treat it as unavailable.
 */
function insecureBackend(): boolean {
  return process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
}

function secureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable() && !insecureBackend()
}

/** Hand only web links to the system; other schemes can launch local programs. */
function openExternalSafely(url: string): void {
  let protocol = ''
  try { protocol = new URL(url).protocol } catch { /* not a URL */ }
  if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
  else console.warn(`Refusing to open ${url}`)
}

/** IPC must come from the app's own page, not from anything else loaded later. */
function fromApp(frameUrl: string | undefined): boolean {
  try { return Boolean(launchUrl) && new URL(frameUrl ?? '').origin === new URL(launchUrl).origin } catch { return false }
}

async function start(): Promise<void> {
  const base = loadConfig()
  const file = settingsPath(app)
  let settings: DesktopSettings = readSettings(file)
  const persist = () => writeSettings(file, settings)
  const git = await findGit()

  const roots = new Map(settings.repos.map((repo) => [repo.id, repo.path]))
  let storedToken = ''
  if (settings.token && secureStorageAvailable()) {
    try {
      storedToken = safeStorage.decryptString(Buffer.from(settings.token.encrypted, 'base64'))
    } catch (error) {
      console.warn('Could not decrypt stored token; ignoring it', error)
      delete settings.token
      persist()
    }
  } else if (settings.token && insecureBackend()) {
    // Only Electron's hard-coded basic_text key is in use, so the saved token
    // is as good as plain text: remove it.
    console.warn('No system credential store; removing the saved GitHub token')
    delete settings.token
    persist()
  } else if (settings.token) {
    // The keyring may just be locked or not running yet: keep the saved token
    // for next time, but don't use it now.
    console.warn('System credential store unavailable; not loading the saved GitHub token')
  }
  const server = createServer({
    ...base,
    localRoots: roots,
    initialLogin: settings.token?.login ?? null,
    deviceFlow: base.deviceFlow ?? (settings.deviceClientId
      ? { clientId: settings.deviceClientId }
      : null),
    publicUrl: 'http://127.0.0.1',
    // __dirname is dist/desktop both unpacked and inside asar, so the built
    // client is always one level up. app.getAppPath() differs between the two.
    clientDir: join(__dirname, '..', 'client'),
    git: git.command,
    gitEnv: git.env,
    desktop: true,
    apiSecret: secret,
    onToken: (token, login) => {
      if (!secureStorageAvailable()) {
        if (token) console.warn('System credential store unavailable; token kept in memory only')
        return
      }
      if (token && login) {
        settings.token = {
          encrypted: safeStorage.encryptString(token).toString('base64'),
          login,
        }
      } else {
        delete settings.token
      }
      persist()
    },
  })
  // The decrypted keychain token is a session token, not an env/file fallback:
  // Clear token must remove it too.
  if (storedToken) server.tokens.set(storedToken, settings.token?.login ?? '')

  const isGitRepository = async (folder: string): Promise<boolean> => {
    try {
      await execFileAsync(git.command, ['rev-parse', '--show-toplevel'], {
        cwd: folder,
        env: { ...process.env, ...git.env, GIT_TERMINAL_PROMPT: '0' },
      })
      return true
    } catch {
      return false
    }
  }

  // The renderer fetches the API secret here rather than from its command
  // line, which other local users can read.
  ipcMain.on('marginalia:apiSecret', (event) => {
    event.returnValue = fromApp(event.senderFrame?.url) ? secret : ''
  })

  ipcMain.handle('marginalia:chooseFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('marginalia:listRepos', () => settings.repos)

  ipcMain.handle('marginalia:addRepo', async (_event, folder: string) => {
    const path = resolve(folder)
    if (!existsSync(path)) throw new Error(`Folder does not exist: ${path}`)
    if (!await isGitRepository(path)) throw new Error(`${path} is not a git repository`)
    const existing = settings.repos.find((repo) => resolve(repo.path) === path)
    if (existing) return settings.repos

    const stem = basename(path)
    let id = stem
    let index = 2
    while (settings.repos.some((repo) => repo.id === id)) id = `${stem}-${index++}`
    settings.repos.push({ id, path })
    roots.set(id, path)
    persist()
    return settings.repos
  })

  ipcMain.handle('marginalia:removeRepo', async (_event, id: string) => {
    settings.repos = settings.repos.filter((repo) => repo.id !== id)
    roots.delete(id)
    persist()
    return settings.repos
  })

  ipcMain.handle('marginalia:openExternal', async (_event, url: string) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Refusing to open ${parsed.protocol} URL`)
    }
    await shell.openExternal(url)
  })

  const icon = join(__dirname, '..', '..', 'build', 'icon.png')
  const preload = join(__dirname, 'preload.cjs')

  const createWindow = () => {
    const window = new BrowserWindow({
      ...settings.bounds,
      minWidth: 800,
      minHeight: 600,
      show: false,
      icon: existsSync(icon) ? icon : undefined,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    window.once('ready-to-show', () => window.show())
    window.on('close', () => {
      settings.bounds = window.getNormalBounds()
      persist()
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      let sameOrigin = false
      try { sameOrigin = new URL(url).origin === new URL(launchUrl).origin } catch { /* invalid URL */ }
      if (!sameOrigin) {
        event.preventDefault()
        openExternalSafely(url)
      }
    })
    void window.loadURL(launchUrl)
  }
  openWindow = createWindow

  const listen = new Promise<number>((done, fail) => {
    const httpServer = server.app.listen(0, '127.0.0.1', () => {
      const address = httpServer.address()
      if (!address || typeof address === 'string') {
        fail(new Error('Could not determine the local server port'))
        return
      }
      done(address.port)
    })
    httpServer.once('error', fail)
  })
  const port = await listen
  launchUrl = `http://127.0.0.1:${port}`
  server.config.publicUrl = launchUrl
  createWindow()
}

function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [{ role: 'close' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  installMenu()
  return start()
}).catch((error: Error) => {
  console.error(error)
  dialog.showErrorBox('Marginalia could not start', error.message)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (openWindow && BrowserWindow.getAllWindows().length === 0) openWindow()
})
