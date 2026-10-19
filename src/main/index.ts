import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
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
import { parseCleanupRequest } from '@shared/cleanup'
import type { IpcEventName, IpcEventPayload } from '@shared/ipc'
import { MEDIA_SCHEME } from '@shared/media'
import { normalizeAccelerator } from '@shared/shortcut'
import {
  assessDisk,
  mainWindowCloseAction,
  type PreflightInfo,
  type RecordingState
} from '@shared/recording'
import { ChatService } from './ai/chat/service'
import { GeminiClient } from './ai/gemini'
import { KeyStore } from './ai/keys'
import { OpenAiCompatClient } from './ai/openai-compat'
import { SummaryService } from './ai/summary/service'
import { testApiKey } from './ai/test-key'
import { geminiBackend, groqBackend } from './ai/text/backends'
import { TextRouter } from './ai/text/router'
import { TranscriptionService } from './ai/transcription/service'
import { CleanupService } from './cleanup/service'
import { Av1EncoderDetector } from './compaction/encoders'
import { CompactionService } from './compaction/service'
import { ContentAreaService } from './content-area/service'
import { getFfmpegStatus, type StatusOptions } from './ffmpeg'
import { FfmpegInstaller } from './ffmpeg/installer'
import { resolveFfmpegTools } from './ffmpeg/media'
import { freeDiskBytes } from './fs/atomic'
import { CaptureSources } from './capture/sources'
import { loadWindowTools } from './capture/window-info'
import { loadWindowStateProbe } from './capture/window-state'
import { FloatingController } from './floating/controller'
import { isShortcutAvailable } from './floating/shortcut-check'
import { loadForegroundTools } from './floating/foreground'
import { createRecordingTray } from './floating/tray'
import { createBarWindow, createNoteWindow, readDisplays } from './floating/windows'
import { createIpcHandlers } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { LibraryService } from './library/service'
import { TagCatalog } from './tags/catalog'
import { TagService } from './tags/service'
import { loadSqlite } from './library/sqlite'
import { createMediaHandler } from './media/handler'
import { loadMeetingDetail } from './meetings/library'
import { addMeetingNote, deleteMeetingNote, editMeetingNote } from './meetings/notes-store'
import { MeetingsRelocation } from './meetings/relocation'
import { trashMeetingFolder, trashMeetingVideo } from './meetings/trash'
import { sameFolder } from './meetings/paths'
import { isDirectChild, renameMeeting } from './meetings/repository'
import { readSummary } from './meetings/summary-store'
import { readTranscript, renameTranscriptSpeaker } from './meetings/transcript-store'
import { RecoveryService } from './recording/recovery-service'
import { createRecorderSessionFactory, recorderPaths } from './recording/recorder-window'
import { RecordingService } from './recording/service'
import { installPermissionHandlers } from './security'
import { readVideoEncoderSync, resolveMeetingsDir, SettingsStore } from './settings/store'
import { createElectronUpdateDriver } from './updater/electron'
import { UpdaterService } from './updater/service'
import { createMainWindow } from './window'

const log = (message: string): void => console.log(message)

// Só em desenvolvimento: dados e Reuniões numa pasta à parte, para testes automáticos
// não tocarem nas configurações nem nas gravações reais.
const devUserData = app.isPackaged ? undefined : process.env['CLEARMEET_USER_DATA']
const devMeetingsDir = app.isPackaged ? undefined : process.env['CLEARMEET_MEETINGS_DIR']
if (devUserData) app.setPath('userData', devUserData)
// Sem a detecção nativa de oclusão do Windows, o Chromium continua pintando janelas suas que
// estão cobertas por outras. Vale para a janela de gravação e
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
    // Pastas mexidas fora do app (Explorador) aparecem ao voltar para a janela.
    window.on('focus', () => void library?.reconcile())
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
  let library: LibraryService | null = null
  let compaction: CompactionService | null = null

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
    if (app.isPackaged) {
      Menu.setApplicationMenu(null)
      // Mesmo `appId` do instalador: atalhos e a barra de tarefas agrupam no mesmo app.
      app.setAppUserModelId('com.mtzdev.clearmeet')
    }

    const settings = new SettingsStore(app.getPath('userData'), app.getPath('documents'))
    await settings.load()
    nativeTheme.themeSource = settings.get().theme
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
    // Preenchido adiante; as Compactações e miniaturas consultam enquanto a pasta é trocada.
    let relocation: MeetingsRelocation | null = null

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const recorderFactory = createRecorderSessionFactory({
      ipcMain,
      pageUrl: devUrl ? `${devUrl}/recorder.html` : null,
      ...recorderPaths(__dirname),
      log
    })
    const windowTools = await loadWindowTools(log)
    const captureSources = new CaptureSources(
      (contents) => recorderFactory.isRecorder(contents),
      () => BrowserWindow.getAllWindows(),
      windowTools
    )
    const thumbnailsDir = join(app.getPath('userData'), 'thumbnails')
    protocol.handle(
      MEDIA_SCHEME,
      createMediaHandler(meetingsDir, () => thumbnailsDir)
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
      if (event === 'recording:state') {
        floating?.onRecordingState(payload as RecordingState)
        library?.onRecordingState(payload as RecordingState)
        compaction?.onRecordingState(payload as RecordingState)
      }
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
      selectSource: (source, systemAudio) => captureSources.select(source, systemAudio),
      emit: dispatchEvent,
      freeBytes: freeDiskBytes,
      windowState,
      restoreWindow: (hwnd) => windowTools.restoreIfMinimized(hwnd),
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

    const libraryIndex = new LibraryService({
      dbPath: join(app.getPath('userData'), 'library.db'),
      thumbnailsDir,
      meetingsDir,
      activeFolder: () => service.activeFolder(),
      loadSqlite,
      getTools,
      // As miniaturas esperam a gravação terminar para não disputar a máquina com ela.
      canMakeThumbnails: () => !service.isBusy(),
      emitChanged: () => sendToRenderer('library:changed', null),
      now: () => Date.now(),
      log
    })
    library = libraryIndex

    // Em automação de desenvolvimento o Vídeo gravado fica como saiu do gravador.
    const automation = !app.isPackaged && Boolean(process.env['CLEARMEET_AUTOMATION'])
    const contentArea = new ContentAreaService({
      meetingsDir,
      cacheDir: join(app.getPath('userData'), 'content-area'),
      getTools,
      canRun: () => !service.isBusy() && relocation?.isRunning !== true,
      log
    })
    const compactor = new CompactionService({
      meetingsDir,
      getTools,
      enabled: () => settings.get().compaction && !automation,
      mode: () => settings.get().compactionMode,
      // Como as miniaturas, a Compactação espera a gravação terminar (e a troca de pasta).
      canRun: () => !service.isBusy() && relocation?.isRunning !== true,
      detector: new Av1EncoderDetector(),
      contentArea,
      emit: (event) => sendToRenderer('compaction:changed', event),
      onFolderChanged: (folder) => void libraryIndex.refresh(folder),
      now: () => Date.now(),
      log
    })
    compaction = compactor

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
      emit: (report) => {
        sendToRenderer('recovery:report', report)
        // Reuniões recuperadas mudaram de estado no disco.
        if (!report.running && report.checkedAt !== null) {
          void libraryIndex.reconcile({ force: true })
          void compactor.scan()
        }
      },
      now: () => Date.now(),
      log
    })

    const textRouter = new TextRouter({
      groqKey: () => keys.get('groq'),
      geminiKey: () => keys.get('gemini'),
      groqModel: () => settings.get().groqTextModel,
      geminiModel: () => settings.get().geminiTextModel,
      createGroq: (key) => groqBackend(new OpenAiCompatClient(key, { log })),
      createGemini: (key) => geminiBackend(new GeminiClient(key, { log })),
      log
    })
    const summary = new SummaryService({
      meetingsDir,
      router: textRouter,
      emit: (event) => {
        sendToRenderer('summary:changed', event)
        libraryIndex.onSummaryChanged(event)
      },
      now: () => Date.now(),
      log
    })
    await summary.recoverInterrupted()
    const chat = new ChatService({
      meetingsDir,
      router: textRouter,
      emit: (event) => sendToRenderer('chat:event', event),
      now: () => Date.now(),
      newId: () => randomUUID(),
      log
    })

    const transcription = new TranscriptionService({
      meetingsDir,
      getTools,
      geminiKey: () => keys.get('gemini'),
      model: () => settings.get().transcriptionModel,
      createClient: (key) => new GeminiClient(key, { log }),
      tempRoot: tmpdir(),
      emit: (event) => {
        sendToRenderer('transcript:changed', event)
        libraryIndex.onTranscriptChanged(event)
      },
      onReady: (folder, summaryRequested) => {
        if (summaryRequested) void summary.startAfterTranscript(folder)
      },
      now: () => Date.now(),
      log
    })
    await transcription.recoverInterrupted()
    // Depois das recuperações acima, que corrigem estados no `meeting.json`.
    libraryIndex.start()
    void compactor.start()

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

    /** Gravando, com IA em andamento ou compactando: mexer na pasta agora atrapalharia o app. */
    const isFolderBusy = (folder: string): boolean => {
      const recordingFolder = service.activeFolder()
      return (
        transcription.isActive(folder) ||
        summary.isActive(folder) ||
        chat.isActive(folder) ||
        compactor.isActive(folder) ||
        (recordingFolder !== null && sameFolder(folder, recordingFolder))
      )
    }

    const tags = new TagService({
      catalog: new TagCatalog(join(app.getPath('userData'), 'tags.json')),
      meetingsDir,
      indexed: () => libraryIndex.tagCounts(),
      refresh: (folder) => libraryIndex.refresh(folder),
      emitChanged: () => sendToRenderer('library:changed', null)
    })

    const cleanup = new CleanupService({
      olderThan: (cutoffMs) => libraryIndex.olderThan(cutoffMs),
      meetingsDir,
      isBusy: isFolderBusy,
      trash: (path) => shell.trashItem(path),
      refresh: (folder) => libraryIndex.refresh(folder),
      now: () => Date.now(),
      log
    })

    const INVALID_CLEANUP = {
      ok: false,
      error: { code: 'invalid-request', message: 'Pedido inválido.' }
    } as const

    /** Depois de uma edição que deu certo, o índice relê a pasta (a edição já está no disco). */
    const afterEdit = async <T extends { ok: boolean }>(
      folder: string,
      edit: Promise<T>
    ): Promise<T> => {
      const result = await edit
      if (result.ok) void libraryIndex.refresh(folder)
      return result
    }

    const updater = new UpdaterService({
      driver: app.isPackaged ? createElectronUpdateDriver(log) : null,
      recordingPhase: () => service.getState().phase,
      emit: (state) => sendToRenderer('update:changed', state),
      log
    })

    const ffmpegInstaller = new FfmpegInstaller({
      destRoot: ffmpegOptions.downloadedRoot,
      getStatus: () => getFfmpegStatus(ffmpegOptions),
      emit: (state) => sendToRenderer('ffmpeg:install', state),
      onInstalled: () => {
        // Miniaturas e Compactações que esperavam pelo FFmpeg seguem.
        void libraryIndex.reconcile({ force: true })
        void compactor.scan()
      },
      now: () => Date.now(),
      log
    })

    const meetingsRelocation = new MeetingsRelocation({
      currentDir: meetingsDir,
      chooseFolder: async (defaultPath) => {
        const options: Electron.OpenDialogOptions = {
          title: 'Escolher a pasta das Reuniões',
          defaultPath,
          properties: ['openDirectory', 'createDirectory']
        }
        const result =
          mainWindow && !mainWindow.isDestroyed()
            ? await dialog.showOpenDialog(mainWindow, options)
            : await dialog.showOpenDialog(options)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      busyReason: () => {
        if (service.isBusy()) {
          return 'Há uma gravação em andamento. Troque a pasta quando ela terminar.'
        }
        if (transcription.hasActive() || summary.hasActive() || chat.hasActive()) {
          return 'A IA está trabalhando em uma Reunião. Troque a pasta quando ela terminar.'
        }
        if (recovery.getReport().running) {
          return 'O app está recuperando gravações. Tente de novo em instantes.'
        }
        return null
      },
      pause: async () => {
        await contentArea.release()
        await compactor.pause()
        await libraryIndex.pause()
      },
      resume: () => {
        libraryIndex.resume()
        compactor.kick()
        void compactor.scan()
      },
      commit: async (newDir) => {
        await settings.setMeetingsDir(newDir)
        // A tela de Gravar não deve mais apontar para uma Reunião da pasta antiga.
        await service.acknowledge()
      },
      emit: (progress) => sendToRenderer('meetingsDir:progress', progress),
      log
    })
    relocation = meetingsRelocation

    registerIpcHandlers(
      ipcMain,
      createIpcHandlers({
        getAppVersion: () => app.getVersion(),
        getFfmpegStatus: () => getFfmpegStatus(ffmpegOptions),
        installFfmpeg: () => ffmpegInstaller.start(),
        relocationBlock: () =>
          meetingsRelocation.isRunning
            ? 'A pasta das Reuniões está sendo trocada. Aguarde terminar.'
            : null,
        listSources: (request) => captureSources.list(request),
        preflight,
        recording: service,
        renameMeeting: async (folder, name) => {
          await contentArea.release()
          if (transcription.isActive(folder)) {
            return {
              ok: false,
              error: {
                code: 'busy',
                message: 'A Reunião está sendo transcrita. Renomeie quando terminar.'
              }
            }
          }
          if (summary.isActive(folder) || chat.isActive(folder)) {
            return {
              ok: false,
              error: {
                code: 'busy',
                message: 'A IA está trabalhando nesta Reunião. Renomeie quando terminar.'
              }
            }
          }
          if (folder === service.activeFolder()) {
            return {
              ok: false,
              error: { code: 'busy', message: 'A Reunião ainda está sendo gravada.' }
            }
          }
          if (compactor.isActive(folder)) {
            return {
              ok: false,
              error: {
                code: 'busy',
                message: 'O Vídeo está sendo compactado. Renomeie quando terminar.'
              }
            }
          }
          const result = await renameMeeting(meetingsDir(), folder, name)
          if (result.ok) {
            service.updateFinished({ folder: result.value.folder, name: result.value.name }, folder)
            void libraryIndex.refresh(result.value.folder)
          }
          return result
        },
        deleteMeeting: async (folder) => {
          if (typeof folder !== 'string') {
            return {
              ok: false,
              error: { code: 'invalid-request', message: 'Pedido inválido.' }
            }
          }
          await contentArea.release()
          if (isFolderBusy(folder)) {
            return {
              ok: false,
              error: {
                code: 'busy',
                message:
                  'A Reunião está em uso (gravação, IA ou Compactação). Exclua quando terminar.'
              }
            }
          }
          const result = await trashMeetingFolder(meetingsDir(), folder, (path) =>
            shell.trashItem(path)
          )
          if (result.ok) service.clearFinished(folder)
          // O índice relê a pasta: some se foi excluída e reflete o que sobrou se a exclusão falhou.
          await libraryIndex.refresh(folder)
          return result
        },
        deleteMeetingVideo: async (folder) => {
          await contentArea.release()
          if (typeof folder === 'string' && isFolderBusy(folder)) {
            return {
              ok: false,
              error: {
                code: 'busy',
                message: 'A Reunião está em uso (gravação ou Compactação). Tente quando terminar.'
              }
            }
          }
          const result = await trashMeetingVideo(meetingsDir(), folder, (path) =>
            shell.trashItem(path)
          )
          await libraryIndex.refresh(folder)
          return result
        },
        retryCompaction: (folder) => compactor.retry(folder),
        contentArea: (folder) => contentArea.get(folder),
        cleanup: {
          preview: (request) => {
            const parsed = parseCleanupRequest(request)
            return parsed ? cleanup.preview(parsed) : Promise.resolve(INVALID_CLEANUP)
          },
          run: (request) => {
            const parsed = parseCleanupRequest(request)
            return parsed ? cleanup.run(parsed) : Promise.resolve(INVALID_CLEANUP)
          }
        },
        revealMeeting: async (folder) => {
          if (isDirectChild(meetingsDir(), folder)) await shell.openPath(folder)
        },
        library: {
          search: (query) => libraryIndex.search(query),
          refresh: () => {
            void libraryIndex.reconcile()
            return Promise.resolve()
          },
          notes: async (id) => {
            const notes = await libraryIndex.notesFor(id)
            return notes
              ? { ok: true, value: notes }
              : {
                  ok: false,
                  error: { code: 'not-found', message: 'A Reunião não foi encontrada.' }
                }
          }
        },
        meetings: {
          get: async (id) => {
            const folder = await libraryIndex.folderFor(id)
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
            afterEdit(folder, addMeetingNote(meetingsDir(), folder, { offsetMs, text })),
          updateNote: (folder, noteId, text) =>
            afterEdit(folder, editMeetingNote(meetingsDir(), folder, noteId, text)),
          deleteNote: (folder, noteId) =>
            afterEdit(folder, deleteMeetingNote(meetingsDir(), folder, noteId)),
          addTag: (folder, name) => tags.add(folder, name),
          removeTag: (folder, name) => tags.remove(folder, name)
        },
        tags: {
          list: () => tags.list(),
          create: (name) => tags.create(name),
          rename: (from, to) => tags.rename(from, to),
          delete: (name) => tags.delete(name)
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
            return afterEdit(
              folder,
              renameTranscriptSpeaker(
                folder,
                String(speakerId),
                typeof name === 'string' ? name : ''
              )
            )
          },
          cancel: (folder) => transcription.cancel(folder)
        },
        summary: {
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
            return readSummary(folder)
          },
          start: (folder) => summary.start(folder),
          cancel: (folder) => summary.cancel(folder)
        },
        chat: {
          get: (folder) => chat.get(folder),
          send: (folder, text) => chat.send(folder, typeof text === 'string' ? text : null),
          stop: (folder) => chat.stop(folder),
          clear: (folder) => chat.clear(folder)
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
          update: async (patch) => {
            const before = meetingsDir()
            const view = await settings.update(patch)
            if (meetingsDir() !== before) void libraryIndex.reconcile({ force: true })
            if (patch.compaction !== undefined) compactor.onSettingsChanged()
            if (patch.theme !== undefined) nativeTheme.themeSource = settings.get().theme
            return view
          },
          setNoteShortcut: async (accelerator) => {
            const normalized = normalizeAccelerator(accelerator)
            if (!normalized) {
              return {
                ok: false,
                error: { code: 'invalid-request', message: 'Esse atalho não é válido.' }
              }
            }
            // Durante a gravação o app já tem o seu atalho registrado: não dá para testar.
            if (
              normalized !== settings.get().noteShortcut &&
              !service.isBusy() &&
              !isShortcutAvailable(globalShortcut, normalized)
            ) {
              return {
                ok: false,
                error: { code: 'busy', message: 'Atalho em uso por outro programa.' }
              }
            }
            return { ok: true, value: await settings.update({ noteShortcut: normalized }) }
          }
        },
        meetingsDir: {
          choose: () => meetingsRelocation.choose(),
          apply: (request) => meetingsRelocation.apply(request),
          cancel: () => meetingsRelocation.cancel(),
          open: async (which) => {
            const target = which === 'previous' ? meetingsRelocation.previousDir() : meetingsDir()
            if (!target) return
            if (which === 'current') await mkdir(target, { recursive: true }).catch(() => undefined)
            await shell.openPath(target)
          }
        },
        update: { getState: () => updater.getState(), restart: () => updater.restart() },
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

    app.on('will-quit', () => {
      updater.stop()
      compactor.abortAll()
      void contentArea.release()
      globalShortcut.unregisterAll()
      void libraryIndex.close()
    })

    // Fechar o app com a gravação em andamento: para, finaliza e só então sai.
    app.on('before-quit', (event) => {
      if (quitRequested || !service.isBusy()) return
      quitRequested = true
      event.preventDefault()
      void service.stop('app-quit').finally(() => app.quit())
    })

    updater.start()
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
