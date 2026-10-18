import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { WINDOW_BACKGROUND } from '@shared/theme'

function backgroundForTheme(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'ClearMeet',
    width: 1120,
    height: 740,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: backgroundForTheme(),
    // Instalado, o ícone vem do executável; em desenvolvimento, do arquivo em `build/`.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build', 'icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Acompanha o tema do Windows enquanto o renderer ainda não pintou.
  const syncBackground = (): void => window.setBackgroundColor(backgroundForTheme())
  nativeTheme.on('updated', syncBackground)
  window.on('closed', () => nativeTheme.off('updated', syncBackground))

  window.once('ready-to-show', () => window.show())

  // O app é uma única página: nada de abrir janelas nem navegar para fora dela.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (!devUrl || !url.startsWith(devUrl)) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  return window
}
