import { app, BrowserWindow, clipboard, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { autoUpdater } from 'electron-updater'
import type { AnswerRequest, View } from './contract.cjs'

const page = join(__dirname, '../dist/index.html')
const views = {
  dashboard: [1050, 700],
  composer: [540, 140],
  answer: [540, 500],
  widget: [162, 50],
} as const
let window: BrowserWindow | undefined
let dashboardBounds: Electron.Rectangle | undefined
let currentView: View = 'dashboard'
let dashboardMaximized = false
let active: { id: string; controller: AbortController } | undefined

function handle(channel: string, listener: (value: unknown) => unknown) {
  ipcMain.handle(channel, (event, value: unknown) => {
    const frame = event.senderFrame
    if (event.sender !== window?.webContents || frame !== event.sender.mainFrame ||
        frame?.url !== pathToFileURL(page).href) {
      throw new Error('Invalid window')
    }
    return listener(value)
  })
}

function resize(view: View) {
  if (!window || currentView === view) return
  const bounds = window.getNormalBounds()
  const work = screen.getDisplayMatching(bounds).workArea
  if (currentView === 'dashboard') {
    dashboardBounds = bounds
    dashboardMaximized = window.isMaximized()
    if (dashboardMaximized) window.unmaximize()
  }
  const [width, height] = views[view]
  const overlay = view !== 'dashboard'
  window.setMinimumSize(overlay ? width : 680, overlay ? height : 460)
  window.setAlwaysOnTop(overlay)
  window.setResizable(!overlay)
  if (!overlay && dashboardBounds) {
    window.setBounds(dashboardBounds)
    if (dashboardMaximized) window.maximize()
  } else {
    const x = currentView === 'dashboard' ? work.x + Math.floor((work.width - width) / 2) : bounds.x
    const y = currentView === 'dashboard' ? work.y + 44 : bounds.y
    window.setBounds({
      width, height,
      x: Math.max(work.x, Math.min(x, work.x + work.width - width)),
      y: Math.max(work.y, Math.min(y, work.y + work.height - height)),
    })
  }
  currentView = view
}

function isAnswerRequest(value: unknown): value is AnswerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<AnswerRequest>
  return typeof request.id === 'string' && /^[a-f0-9-]{36}$/.test(request.id) &&
    typeof request.model === 'string' && /^[a-zA-Z0-9._/:-]{1,150}$/.test(request.model) &&
    Array.isArray(request.messages) && request.messages.length > 0 && request.messages.length <= 24 &&
    request.messages.every(message => message &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' && message.content.length <= 16000)
}

async function answer(value: unknown) {
  if (!isAnswerRequest(value)) throw new Error('Enter a valid local model name and prompt.')
  if (active) throw new Error('An answer is already streaming.')
  const controller = new AbortController()
  const request = { id: value.id, controller }
  active = request
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])
  let finished = false
  let hasText = false
  let pending = ''
  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: value.model, messages: value.messages, stream: true }),
      signal,
      redirect: 'error',
    })
    if (response.status === 404) throw new Error('Pull the selected model in Ollama, then try again.')
    if (!response.ok || !response.body) throw new Error(`Ollama returned HTTP ${response.status}.`)
    function receive(line: string) {
      if (!line.trim()) return
      const chunk = JSON.parse(line) as { message?: { content?: unknown }; done?: boolean; error?: string }
      if (chunk.error) throw new Error(chunk.error)
      if (typeof chunk.message?.content === 'string' && chunk.message.content) {
        hasText = true
        window?.webContents.send('answer-chunk', { id: request.id, text: chunk.message.content })
      }
      if (chunk.done) finished = true
    }
    const stream = response.body.pipeThrough(new TextDecoderStream())
    for await (const chunk of stream) {
      pending += chunk
      if (pending.length > 2_000_000) throw new Error('Ollama sent an oversized response.')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) receive(line)
      if (finished) break
    }
    if (!finished && pending) receive(pending)
    if (!finished) throw new Error('The connection closed before the answer finished.')
    if (!hasText) throw new Error('The model returned an empty answer.')
  } catch (error) {
    if (controller.signal.aborted) return
    if (signal.aborted) throw new Error('The model took too long to respond.')
    if (error instanceof TypeError) throw new Error('Start Ollama on this computer and try again.')
    throw error
  } finally {
    if (active === request) active = undefined
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(() => {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    let updateReady = false
    handle('version', () => app.getVersion())
    handle('check-update', async () => {
      if (!app.isPackaged) return 'development'
      if (updateReady) return 'ready'
      const update = await autoUpdater.checkForUpdates()
      if (!update?.isUpdateAvailable) return 'current'
      await autoUpdater.downloadUpdate()
      updateReady = true
      return 'ready'
    })
    handle('install-update', () => {
      if (updateReady && currentView === 'dashboard') autoUpdater.quitAndInstall()
    })
    handle('view', value => {
      if (typeof value === 'string' && Object.hasOwn(views, value)) resize(value as View)
    })
    handle('window-action', value => {
      if (value === 'minimize') window?.minimize()
      if (value === 'close') window?.close()
      if (value === 'maximize' && currentView === 'dashboard') {
        if (window?.isMaximized()) window.unmaximize()
        else window?.maximize()
      }
    })
    handle('answer', answer)
    handle('cancel-answer', id => {
      if (active && active.id === id) active.controller.abort()
    })
    handle('copy', text => {
      if (typeof text === 'string' && text.length <= 64000) clipboard.writeText(text)
    })
    window = new BrowserWindow({
      width: 1050, height: 700, minWidth: 680, minHeight: 460,
      frame: false, show: false, backgroundColor: '#0c0c0e',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    const session = window.webContents.session
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.setPermissionCheckHandler(() => false)
    window.once('ready-to-show', () => window?.show())
    window.on('closed', () => { active?.controller.abort(); window = undefined })
    void window.loadFile(page)
  }).catch(error => { console.error(error); app.quit() })
}
app.on('window-all-closed', () => app.quit())
