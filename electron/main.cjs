const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, screen, session } = require('electron')
const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')

const isDev = !app.isPackaged
let backendProcess = null
let backendFailureShown = false
const desktopApiToken = crypto.randomBytes(32).toString('hex')
const desktopInstanceId = crypto.randomUUID()

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

if (process.platform === 'win32') {
  app.setAppUserModelId('io.github.pilvik1.tara')
}

function logDesktop(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  try {
    fs.mkdirSync(app.getPath('logs'), { recursive: true })
    fs.appendFileSync(path.join(app.getPath('logs'), 'tara-desktop.log'), line)
  } catch {
    // Logging must never prevent the app from opening.
  }
  console.log(line.trim())
}

function recordingsDir() {
  const dir = path.join(app.getPath('userData'), 'recordings')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeName(title) {
  return String(title || 'meeting')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60)
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'Tara',
    autoHideMenuBar: true,
    icon: isDev
      ? path.join(__dirname, '..', 'public', 'favicon.ico')
      : path.join(__dirname, '..', 'dist', 'favicon.ico'),
    backgroundColor: '#eef1ef',
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#eee5e9',
            symbolColor: '#383d3b',
            height: 42,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) {
    window.loadURL('http://127.0.0.1:5173')
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logDesktop(`renderer failed to load: ${errorCode} ${errorDescription} ${validatedURL} mainFrame=${isMainFrame}`)
  })

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logDesktop(`renderer console level=${level}: ${message} (${sourceId}:${line})`)
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!trustedCaptureOrigin(navigationUrl)) event.preventDefault()
  })
}

function trustedCaptureOrigin(origin) {
  const value = String(origin || '')
  return value.startsWith('file://') || value === 'null' || value.startsWith('http://127.0.0.1:')
}

function configureMediaCapture() {
  const allowedPermissions = [
    'media',
    'display-capture',
    'loopback-network',
    'local-network',
    'local-network-access',
  ]
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (!allowedPermissions.includes(permission)) return false
    return trustedCaptureOrigin(requestingOrigin)
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (!allowedPermissions.includes(permission)) {
      callback(false)
      return
    }
    callback(trustedCaptureOrigin(webContents.getURL()))
  })

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      // Windows captures the primary screen plus WASAPI loopback audio, which
      // works with headsets. Supported macOS versions may use the native picker.
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      })
      const primaryDisplayId = String(screen.getPrimaryDisplay().id)
      const primaryScreen = sources.find((source) => source.display_id === primaryDisplayId) || sources[0]
      if (!primaryScreen) {
        callback({})
        return
      }
      callback({ video: primaryScreen, audio: 'loopback' })
    } catch (error) {
      logDesktop(`display capture setup failed: ${error.message}`)
      callback({})
    }
  }, { useSystemPicker: true })

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1:8765/*'] },
    (details, callback) => {
      details.requestHeaders['X-Tara-Desktop-Token'] = desktopApiToken
      callback({ requestHeaders: details.requestHeaders })
    },
  )
}

function showBackendFailure(message) {
  if (backendFailureShown) return
  backendFailureShown = true
  logDesktop(message)
  dialog.showMessageBox({
    type: 'warning',
    title: 'Tara backend did not start',
    message: 'Tara opened, but the local Python backend did not start.',
    detail: `${message}\n\nRestart Tara. If the problem persists, check tara-desktop.log in the Electron logs directory.`,
    buttons: ['OK'],
  }).catch(() => {
    // Dialog failures should not prevent the renderer from opening.
  })
}

function startBackend() {
  if (isDev || backendProcess) return

  const backendPath = path.join(app.getAppPath(), 'backend', 'main.py')
  const packagedRoot = path.dirname(app.getPath('exe'))
  const bundledBackend = path.join(
    process.resourcesPath,
    'backend',
    process.platform === 'win32' ? 'tara-backend.exe' : 'tara-backend',
  )
  const runtimeCandidates = [
    { command: bundledBackend, args: [] },
    ...(process.platform === 'win32'
    ? [
        { command: path.join(packagedRoot, '.venv', 'Scripts', 'python.exe'), args: [backendPath] },
        { command: 'py', args: ['-3', backendPath] },
        { command: 'python', args: [backendPath] },
      ]
    : [
        { command: path.join(packagedRoot, '.venv', 'bin', 'python'), args: [backendPath] },
        { command: 'python3', args: [backendPath] },
        { command: 'python', args: [backendPath] },
      ]),
  ]
  const env = {
    ...process.env,
    TARA_DATA_DIR: path.join(app.getPath('userData'), 'data'),
    TARA_DESKTOP_API_TOKEN: desktopApiToken,
    TARA_DESKTOP_INSTANCE_ID: desktopInstanceId,
    TARA_LLAMA_SERVER_PATH: path.join(
      process.resourcesPath,
      'local-runtime',
      process.platform === 'win32' ? 'llama-server.exe' : 'llama-server',
    ),
  }

  function tryStart(index) {
    if (index >= runtimeCandidates.length) {
      showBackendFailure('backend failed to start: neither the bundled runtime nor a local Python runtime could launch')
      return
    }
    const { command, args } = runtimeCandidates[index]
    if (path.isAbsolute(command) && !fs.existsSync(command)) {
      logDesktop(`backend runtime candidate missing: ${command}`)
      tryStart(index + 1)
      return
    }
    logDesktop(`starting backend with ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout?.on('data', (chunk) => logDesktop(`backend stdout: ${chunk.toString().trim()}`))
    child.stderr?.on('data', (chunk) => logDesktop(`backend stderr: ${chunk.toString().trim()}`))
    child.once('error', (error) => {
      logDesktop(`backend launch error with ${command}: ${error.message}`)
      tryStart(index + 1)
    })
    child.once('spawn', () => {
      backendProcess = child
      logDesktop(`backend spawned with ${command}`)
    })
    child.once('exit', (code, signal) => {
      logDesktop(`backend exited with code=${code} signal=${signal}`)
      if (backendProcess === child) backendProcess = null
      if (code && !backendFailureShown) {
        showBackendFailure(`backend exited before Tara could use it. code=${code} signal=${signal}`)
      }
    })
  }

  tryStart(0)
}

function backendIsReady() {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port: 8765,
      path: '/health',
      headers: { 'X-Tara-Desktop-Token': desktopApiToken },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          const health = JSON.parse(body)
          resolve(
            response.statusCode === 200 &&
            health.ok === true &&
            (isDev || health.desktop_instance_id === desktopInstanceId)
          )
        } catch {
          resolve(false)
        }
      })
    })
    request.setTimeout(800, () => request.destroy())
    request.once('error', () => resolve(false))
  })
}

async function waitForBackend(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await backendIsReady()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

ipcMain.handle('tara:save-audio', async (_event, input) => {
  const extension = input.mimeType?.includes('mp4') ? 'mp4' : 'webm'
  const source = safeName(input.source || 'mixed')
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeName(input.title)}-${source}.${extension}`
  const audioPath = path.join(recordingsDir(), filename)
  fs.writeFileSync(audioPath, Buffer.from(input.buffer))
  return { path: audioPath }
})

app.whenReady().then(async () => {
  if (process.platform === 'win32') Menu.setApplicationMenu(null)
  configureMediaCapture()
  if (!isDev) startBackend()
  const ready = await waitForBackend()
  if (!ready) showBackendFailure('backend health check did not succeed within 20 seconds')
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  backendProcess?.kill()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
