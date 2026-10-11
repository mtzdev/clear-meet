import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Menu,
  nativeTheme,
  powerSaveBlocker,
  session,
  shell
} from 'electron'
import type { IpcEventName, IpcEventPayload } from '@shared/ipc'
import { assessDisk, type PreflightInfo, type RecordingState } from '@shared/recording'
import { getFfmpegStatus, type StatusOptions } from './ffmpeg'
import { resolveFfmpegTools } from './ffmpeg/media'
import { freeDiskBytes } from './fs/atomic'
import { CaptureSources } from './capture/sources'
import { loadWindowStateProbe } from './capture/window-state'
import { FloatingController } from './floating/controller'
import { loadForegroundTools } from './floating/foreground'
import { createBarWindow, createNoteWindow, readDisplays } from './floating/windows'
import { createIpcHandlers } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { isDirectChild, renameMeeting } from './meetings/repository'
import { RecoveryService } from './recording/recovery-service'
import { createRecorderSessionFactory, recorderPaths } from './recording/recorder-window'
import { RecordingService } from './recording/service'
import { installPermissionHandlers } from './security'
import { readVideoEncoderSync, resolveMeetingsDir, SettingsStore } from './settings/store'
import { createMainWindow } from './window'

const log = (message: string): void => console.log(message)

// Só em desenvolvimento: dados e Reuniões numa pasta à parte, para testes automáticos
// não tocarem nas configurações nem nas gravações reais.
const devUserData = app.isPackaged ? undefined : process.env['CLEARMEET_USER_DATA']
const devMeetingsDir = app.isPackaged ? undefined : process.env['CLEARMEET_MEETINGS_DIR']
if (devUserData) app.setPath('userData', devUserData)
// Sem a detecção nativa de oclusão do Windows, o Chromium continua pintando janelas suas que
// estão cobertas por outras (como o spike da Fase 0 fazia). Vale para a janela de gravação e
// para uma janela do próprio app que esteja sendo gravada.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
// Codificador de vídeo por software (padrão). Flag de processo: só vale ao iniciar o app, e é
// lida do settings.json antes do `ready` (mudar a opção exige reiniciar).
if (readVideoEncoderSync(app.getPath('userData')) === 'software') {
  app.commandLine.appendSwitch('disable-accelerated-video-encode')
}
if (!app.isPackaged && process.env['CLEARMEET_FAKE_MEDIA']) {
  // Microfone sintético (bipes) em vez do real. Atenção: o Chromium também troca a captura de
  // tela por um vídeo falso (tela verde), então só serve para testar o caminho do microfone.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

// Uma instância só: abrir de novo apenas traz a janela existente para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let quitRequested = false

  const openMainWindow = (): BrowserWindow => {
    const window = createMainWindow()
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null
      // A janela de gravação é oculta e mantém o app vivo: fechar a principal durante uma
      // gravação encerra o app (que antes para a gravação e salva tudo — ver `before-quit`).
      if (recording?.isBusy()) app.quit()
    })
    mainWindow = window
    return window
  }

  const sendToRenderer = <E extends IpcEventName>(event: E, payload: IpcEventPayload<E>): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Oculta durante a gravação: os níveis (10x/s) só interessam à barra.
    if (event === 'recording:level' && !mainWindow.isVisible()) return
    mainWindow.webContents.send(event, payload)
  }

  let recording: RecordingService | null = null
  let floating: FloatingController | null = null

  /** Traz a janela principal para a frente (ela fica oculta enquanto a barra flutuante grava). */
  const showMainWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      openMainWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  app.on('second-instance', () => {
    if (mainWindow) showMainWindow()
  })

  void app.whenReady().then(async () => {
    nativeTheme.themeSource = 'system'
    if (app.isPackaged) Menu.setApplicationMenu(null)

    const settings = new SettingsStore(app.getPath('userData'), app.getPath('documents'))
    await settings.load()
    const meetingsDir = (): string =>
      devMeetingsDir ?? resolveMeetingsDir(settings.get(), app.getPath('documents'))

    const ffmpegOptions: StatusOptions = {
      env: process.env,
      downloadedRoot: join(app.getPath('userData'), 'ffmpeg'),
      // `vendor/` (preenchido por `npm run fetch:ffmpeg`) só vale em desenvolvimento.
      vendorRoot: app.isPackaged ? null : join(app.getAppPath(), 'vendor', 'ffmpeg')
    }
    const getTools = (): ReturnType<typeof resolveFfmpegTools> => resolveFfmpegTools(ffmpegOptions)

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const recorderFactory = createRecorderSessionFactory({
      ipcMain,
      pageUrl: devUrl ? `${devUrl}/recorder.html` : null,
      ...recorderPaths(__dirname),
      log
    })
    const captureSources = new CaptureSources(
      (contents) => recorderFactory.isRecorder(contents),
      () => (mainWindow ? [mainWindow] : [])
    )
    captureSources.install(session.defaultSession)
    installPermissionHandlers(
      session.defaultSession,
      (contents) =>
        contents !== null &&
        ((mainWindow !== null && contents === mainWindow.webContents) ||
          recorderFactory.isRecorder(contents))
    )

    // Eventos da gravação: janela principal e barra flutuante recebem o mesmo estado e os mesmos
    // níveis; o controlador da barra a liga e desliga conforme a fase da gravação.
    const dispatchEvent = <E extends IpcEventName>(event: E, payload: IpcEventPayload<E>): void => {
      sendToRenderer(event, payload)
      floating?.forwardToBar(event, payload)
      if (event === 'recording:state') floating?.onRecordingState(payload as RecordingState)
    }

    const windowState = await loadWindowStateProbe(log)
    const foreground = await loadForegroundTools(log)
    const windowContext = {
      devUrl: devUrl ?? null,
      dirname: __dirname,
      log
    }
    const service = new RecordingService({
      config: () => ({ settings: settings.get(), meetingsDir: meetingsDir() }),
      getTools,
      createRecorder: (sink) => recorderFactory.create(sink),
      selectSource: (source) => captureSources.select(source),
      emit: dispatchEvent,
      freeBytes: freeDiskBytes,
      windowState,
      keepAwake: () => {
        const id = powerSaveBlocker.start('prevent-app-suspension')
        return () => {
          if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id)
        }
      },
      now: () => Date.now(),
      log
    })
    recording = service

    floating = new FloatingController({
      recording: service,
      settings: () => settings.get(),
      saveBarPosition: (position) => {
        void settings.setBarPosition(position).catch(() => undefined)
      },
      displays: readDisplays,
      createBar: (position, onMoved) => createBarWindow(windowContext, position, onMoved),
      createNote: () => createNoteWindow(windowContext),
      shortcuts: {
        register: (accelerator, callback) =>
          globalShortcut.register(accelerator, callback) &&
          globalShortcut.isRegistered(accelerator),
        unregister: (accelerator) => globalShortcut.unregister(accelerator)
      },
      foreground: {
        capture: () => foreground.capture(),
        restore: (token) => {
          if (typeof token === 'number') foreground.restore(token)
        }
      },
      mainWindow: {
        hide: () => mainWindow?.hide(),
        // Ao fechar o app no meio da gravação, a janela principal não reaparece durante a finalização.
        show: () => {
          if (!quitRequested) showMainWindow()
        }
      },
      now: () => Date.now(),
      log
    })
    const floatingControls = floating

    const recovery = new RecoveryService({
      meetingsDir,
      getTools,
      activeFolder: () => service.activeFolder(),
      emit: (report) => sendToRenderer('recovery:report', report),
      now: () => Date.now(),
      log
    })

    const preflight = async (): Promise<PreflightInfo> => {
      const dir = meetingsDir()
      const freeBytes = await freeDiskBytes(dir)
      return {
        meetingsDir: dir,
        freeBytes,
        disk: assessDisk(freeBytes),
        ffmpegAvailable: (await getTools()) !== null
      }
    }

    registerIpcHandlers(
      ipcMain,
      createIpcHandlers({
        getAppVersion: () => app.getVersion(),
        getFfmpegStatus: () => getFfmpegStatus(ffmpegOptions),
        listSources: () => captureSources.list(),
        preflight,
        recording: service,
        renameMeeting: async (folder, name) => {
          if (folder === service.activeFolder()) {
            return {
              ok: false,
              error: { code: 'busy', message: 'A Reunião ainda está sendo gravada.' }
            }
          }
          const result = await renameMeeting(meetingsDir(), folder, name)
          if (result.ok) {
            service.updateFinished({ folder: result.value.folder, name: result.value.name }, folder)
          }
          return result
        },
        revealMeeting: async (folder) => {
          if (isDirectChild(meetingsDir(), folder)) await shell.openPath(folder)
        },
        settings: {
          view: () => settings.view(),
          update: (patch) => settings.update(patch)
        },
        recovery: { getReport: () => recovery.getReport(), retry: () => recovery.run() },
        floating: {
          getInfo: () => floatingControls.getInfo(),
          resizeBar: (height) => floatingControls.resizeBar(height),
          showMain: () => floatingControls.showMain(),
          openEditor: () => floatingControls.openEditor(),
          beginNote: () => floatingControls.beginNote(),
          saveNote: (text) => floatingControls.saveNote(text),
          cancelNote: () => floatingControls.cancelNote()
        }
      })
    )

    app.on('will-quit', () => globalShortcut.unregisterAll())

    // Fechar o app com a gravação em andamento: para, finaliza e só então sai.
    app.on('before-quit', (event) => {
      if (quitRequested || !service.isBusy()) return
      quitRequested = true
      event.preventDefault()
      void service.stop('app-quit').finally(() => app.quit())
    })

    openMainWindow()
    if (!process.env['CLEARMEET_AUTOMATION'] || app.isPackaged) {
      void recovery.run()
    } else {
      // Em automação, o cenário decide quando recuperar (testa a recuperação após crash).
      const { runAutomation } = await import('./dev/automation')
      void runAutomation({
        service,
        recovery,
        createRecorder: (sink) => recorderFactory.create(sink),
        getMainWindow: () => mainWindow,
        meetingsDir,
        log
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
