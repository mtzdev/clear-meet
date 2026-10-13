import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Menu,
  nativeTheme,
  powerSaveBlocker,
  protocol,
  safeStorage,
  session,
  shell
} from 'electron'
import { API_KEY_LINKS, isAiProvider } from '@shared/ai'
import type { IpcEventName, IpcEventPayload } from '@shared/ipc'
import { MEDIA_SCHEME } from '@shared/media'
import {
  assessDisk,
  mainWindowCloseAction,
  type PreflightInfo,
  type RecordingState
} from '@shared/recording'
import { GeminiClient } from './ai/gemini'
import { KeyStore } from './ai/keys'
import { testApiKey } from './ai/test-key'
import { TranscriptionService } from './ai/transcription/service'
import { getFfmpegStatus, type StatusOptions } from './ffmpeg'
import { resolveFfmpegTools } from './ffmpeg/media'
import { freeDiskBytes } from './fs/atomic'
import { CaptureSources } from './capture/sources'
import { loadWindowStateProbe } from './capture/window-state'
import { FloatingController } from './floating/controller'
import { loadForegroundTools } from './floating/foreground'
import { createRecordingTray } from './floating/tray'
import { createBarWindow, createNoteWindow, readDisplays } from './floating/windows'
import { createIpcHandlers } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { createMediaHandler } from './media/handler'
import { findMeetingFolder, listMeetings, loadMeetingDetail } from './meetings/library'
import { addMeetingNote, deleteMeetingNote, editMeetingNote } from './meetings/notes-store'
import { isDirectChild, renameMeeting } from './meetings/repository'
import { readTranscript, renameTranscriptSpeaker } from './meetings/transcript-store'
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

// Esquema próprio para o player ler `video.mp4` / `audio.opus` (ver `media/handler.ts`).
// `stream` é necessário para tocar mídia com seek; precisa ser registrado antes do `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// Uma instância só: abrir de novo apenas traz a janela existente para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let quitRequested = false

  const openMainWindow = (): BrowserWindow => {
    const window = createMainWindow()
    // Durante a gravação o X só oculta a janela (a barra continua); fora dela fecha o app.
    // Ao sair de verdade (`quitRequested`, vindo da bandeja ou do before-quit) nada é barrado.
    window.on('close', (event) => {
      if (quitRequested || !recording) return
      if (mainWindowCloseAction(recording.getState().phase) === 'hide') {
        event.preventDefault()
        window.hide()
      }
    })
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

    const keys = new KeyStore(app.getPath('userData'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptString(text),
      decrypt: (data) => safeStorage.decryptString(data)
    })
    await keys.load()

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
    protocol.handle(MEDIA_SCHEME, createMediaHandler(meetingsDir))
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
      tray: createRecordingTray({
        showMain: showMainWindow,
        // Mesmo caminho do botão da barra; o resultado aparece na principal ao finalizar.
        stop: () => void service.stop(),
        // Sair no meio da gravação: o `before-quit` para, salva e só então fecha o app.
        quit: () => app.quit()
      }),
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

    const transcription = new TranscriptionService({
      meetingsDir,
      getTools,
      geminiKey: () => keys.get('gemini'),
      model: () => settings.get().transcriptionModel,
      createClient: (key) => new GeminiClient(key, { log }),
      tempRoot: tmpdir(),
      emit: (event) => sendToRenderer('transcript:changed', event),
      now: () => Date.now(),
      log
    })
    await transcription.recoverInterrupted()

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
          if (transcription.isActive(folder)) {
            return {
              ok: false,
              error: {
                code: 'busy',
                message: 'A Reunião está sendo transcrita. Renomeie quando terminar.'
              }
            }
          }
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
        meetings: {
          list: () => listMeetings(meetingsDir(), service.activeFolder()),
          get: async (id) => {
            const folder = await findMeetingFolder(meetingsDir(), id)
            if (!folder) {
              return {
                ok: false,
                error: {
                  code: 'not-found',
                  message: 'A Reunião não foi encontrada. Ela pode ter sido movida ou apagada.'
                }
              }
            }
            return loadMeetingDetail(meetingsDir(), folder, service.activeFolder(), (target) =>
              transcription.progressFor(target)
            )
          },
          addNote: (folder, offsetMs, text) =>
            addMeetingNote(meetingsDir(), folder, { offsetMs, text }),
          updateNote: (folder, noteId, text) =>
            editMeetingNote(meetingsDir(), folder, noteId, text),
          deleteNote: (folder, noteId) => deleteMeetingNote(meetingsDir(), folder, noteId)
        },
        transcript: {
          get: async (folder) => {
            if (!isDirectChild(meetingsDir(), folder)) {
              return {
                ok: false,
                error: {
                  code: 'invalid-request',
                  message: 'A pasta não está dentro da pasta das Reuniões.'
                }
              }
            }
            return readTranscript(folder)
          },
          start: (folder, requestSummary, model) =>
            transcription.start(folder, requestSummary === true, model),
          renameSpeaker: async (folder, speakerId, name) => {
            if (!isDirectChild(meetingsDir(), folder)) {
              return {
                ok: false,
                error: {
                  code: 'invalid-request',
                  message: 'A pasta não está dentro da pasta das Reuniões.'
                }
              }
            }
            if (transcription.isActive(folder)) {
              return {
                ok: false,
                error: {
                  code: 'busy',
                  message: 'A Reunião está sendo transcrita. Aguarde terminar.'
                }
              }
            }
            return renameTranscriptSpeaker(
              folder,
              String(speakerId),
              typeof name === 'string' ? name : ''
            )
          },
          cancel: (folder) => transcription.cancel(folder)
        },
        ai: {
          getStatus: () => keys.status(),
          setKey: async (provider, key) => {
            if (!isAiProvider(provider)) {
              return {
                ok: false,
                error: { code: 'invalid-request', message: 'Provedor inválido.' }
              }
            }
            const saved = await keys.set(provider, key)
            return saved.ok ? { ok: true, value: keys.status() } : saved
          },
          clearKey: async (provider) => {
            if (isAiProvider(provider)) await keys.clear(provider)
            return keys.status()
          },
          testKey: (provider, key) => {
            const candidate = key ?? (isAiProvider(provider) ? keys.get(provider) : null)
            if (!isAiProvider(provider) || !candidate) {
              return Promise.resolve({
                ok: false,
                kind: 'invalid-key',
                message: 'Cole a chave para testar.'
              })
            }
            return testApiKey(provider, candidate, {
              fetch: (input, init) => fetch(input, init),
              geminiModel: settings.get().transcriptionModel
            })
          }
        },
        openExternal: async (url) => {
          if (Object.values(API_KEY_LINKS).includes(url)) {
            await shell.openExternal(url)
          }
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
