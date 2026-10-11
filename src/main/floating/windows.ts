import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { BAR_SIZE, NOTE_WINDOW_SIZE, type Point, type Rect } from '@shared/floating'
import type { IpcEventName, IpcEventPayload } from '@shared/ipc'
import type { BarHandle, NoteHandle } from './controller'

/** Páginas da entrada `floating.html`: a mesma página, escolhida pelo hash. */
type FloatingView = 'bar' | 'note'

interface WindowContext {
  /** Página `floating.html` do servidor de desenvolvimento (`ELECTRON_RENDERER_URL`) ou `null`. */
  devUrl: string | null
  /** Pasta `out/main` (onde o bundle do main roda), para achar o preload e a página. */
  dirname: string
  log?: (message: string) => void
}

function send<E extends IpcEventName>(
  window: BrowserWindow,
  event: E,
  payload: IpcEventPayload<E>
): void {
  if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(event, payload)
  }
}

function load(window: BrowserWindow, view: FloatingView, context: WindowContext): void {
  const loading = context.devUrl
    ? window.loadURL(`${context.devUrl}/floating.html#${view}`)
    : window.loadFile(join(context.dirname, '../renderer/floating.html'), { hash: view })
  loading.catch((error: unknown) =>
    context.log?.(`[floating] falha ao carregar ${view}: ${String(error)}`)
  )
}

/** Opções comuns: sem moldura, transparente, sempre no topo, fora da barra de tarefas. */
function baseOptions(context: WindowContext): Electron.BrowserWindowConstructorOptions {
  return {
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(context.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A barra segue atualizando o tempo mesmo coberta por outras janelas.
      backgroundThrottling: false
    }
  }
}

function lockNavigation(window: BrowserWindow, devUrl: string | null): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault()
  })
}

/**
 * Acima de janelas em tela cheia (Zoom, Teams, apresentações). `screen-saver` é o nível mais
 * alto do Windows para janelas comuns.
 */
function pinOnTop(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, 'screen-saver')
}

/**
 * A barra: não rouba o foco ao ser clicada (assim pausar/parar não tira o foco da reunião),
 * arrastável pela própria página e fora da captura (`setContentProtection`, validado na Fase 0).
 */
export function createBarWindow(
  context: WindowContext,
  position: Point,
  onMoved: (position: Point) => void
): BarHandle {
  const window = new BrowserWindow({
    ...baseOptions(context),
    ...BAR_SIZE,
    x: position.x,
    y: position.y,
    focusable: false,
    title: 'ClearMeet (barra)'
  })
  window.setContentProtection(true)
  pinOnTop(window)
  lockNavigation(window, context.devUrl)
  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return
    pinOnTop(window)
    window.showInactive()
  })
  window.on('moved', () => {
    if (window.isDestroyed()) return
    const { x, y } = window.getBounds()
    onMoved({ x, y })
  })
  load(window, 'bar', context)

  return {
    getBounds: (): Rect => window.getBounds(),
    setHeight: (height) => {
      if (window.isDestroyed()) return
      const bounds = window.getBounds()
      if (bounds.height !== height) window.setBounds({ ...bounds, height })
    },
    send: (event, payload) => send(window, event, payload),
    close: () => {
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

/** O campo de Anotação: criado oculto no início da gravação, para abrir sem demora. */
export function createNoteWindow(context: WindowContext): NoteHandle {
  const window = new BrowserWindow({
    ...baseOptions(context),
    ...NOTE_WINDOW_SIZE,
    title: 'ClearMeet (Anotação)'
  })
  window.setContentProtection(true)
  lockNavigation(window, context.devUrl)
  load(window, 'note', context)

  return {
    showFocused: (position) => {
      if (window.isDestroyed()) return
      window.setPosition(position.x, position.y)
      pinOnTop(window)
      window.show()
      window.focus()
      window.webContents.focus()
    },
    hide: () => {
      if (!window.isDestroyed()) window.hide()
    },
    isVisible: () => !window.isDestroyed() && window.isVisible(),
    send: (event, payload) => send(window, event, payload),
    close: () => {
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

/** Áreas úteis dos monitores (sem a barra de tarefas) e a do monitor principal. */
export function readDisplays(): { workAreas: Rect[]; primary: Rect } {
  return {
    workAreas: screen.getAllDisplays().map((display) => display.workArea),
    primary: screen.getPrimaryDisplay().workArea
  }
}
