import { join } from 'node:path'
import { BrowserWindow, type IpcMain, type WebContents } from 'electron'
import {
  RECORDER_CHANNELS,
  type RecorderChunkKind,
  type RecorderCommand,
  type RecorderCommandName,
  type RecorderCommandMessage,
  type RecorderEvent,
  type RecorderReply,
  type RecorderResults
} from '@shared/recorder'
import type { RecorderSession, RecorderSink } from './service'

interface Pending {
  resolve(result: RecorderResults[keyof RecorderResults]): void
  reject(error: Error): void
}

interface ActiveRecorder {
  contents: WebContents
  sink: RecorderSink
  pending: Map<number, Pending>
}

function isChunkKind(value: unknown): value is RecorderChunkKind {
  return value === 'video' || value === 'audio'
}

/**
 * Janela de gravação: um `BrowserWindow` oculto (nunca mostrado) onde roda a captura. Fica
 * fora da UI para que ela possa recarregar ou sumir sem afetar a gravação.
 * `backgroundThrottling: false` mantém timers e promessas rodando com a janela oculta.
 *
 * `installRecorderIpc` registra os canais uma vez; cada gravação cria uma janela nova
 * e a destrói ao fim. Só mensagens vindas da janela ativa são aceitas.
 */
export function createRecorderSessionFactory(options: {
  ipcMain: IpcMain
  /** Página `recorder.html` do renderer: URL do servidor de desenvolvimento ou arquivo. */
  pageUrl: string | null
  pageFile: string
  preloadPath: string
  log?: (message: string) => void
}): {
  create(sink: RecorderSink): Promise<RecorderSession>
  /** `true` se `contents` é a janela de gravação ativa (o handler de mídia só atende a ela). */
  isRecorder(contents: WebContents | null | undefined): boolean
} {
  const { ipcMain, log } = options
  let active: ActiveRecorder | null = null

  const fromActive = (sender: WebContents): ActiveRecorder | null =>
    active && sender === active.contents ? active : null

  ipcMain.handle(RECORDER_CHANNELS.chunk, async (event, kind: unknown, data: unknown) => {
    const recorder = fromActive(event.sender)
    if (!recorder || !isChunkKind(kind)) return
    const buffer =
      data instanceof ArrayBuffer
        ? data
        : ArrayBuffer.isView(data)
          ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
          : null
    if (buffer) await recorder.sink.chunk(kind, buffer)
  })

  ipcMain.on(RECORDER_CHANNELS.reply, (event, reply: RecorderReply) => {
    const recorder = fromActive(event.sender)
    const pending = recorder?.pending.get(reply.id)
    if (!recorder || !pending) return
    recorder.pending.delete(reply.id)
    if (reply.ok) pending.resolve(reply.result)
    else pending.reject(new Error(reply.error))
  })

  ipcMain.on(RECORDER_CHANNELS.event, (event, recorderEvent: RecorderEvent) => {
    fromActive(event.sender)?.sink.event(recorderEvent)
  })

  return {
    isRecorder: (contents) => active !== null && contents === active.contents,

    async create(sink) {
      const window = new BrowserWindow({
        show: false,
        width: 480,
        height: 320,
        skipTaskbar: true,
        title: 'ClearMeet (gravação)',
        webPreferences: {
          preload: options.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
          // O AudioContext do mix precisa iniciar sem gesto do usuário.
          autoplayPolicy: 'no-user-gesture-required'
        }
      })
      const contents = window.webContents
      const recorder: ActiveRecorder = { contents, sink, pending: new Map() }
      active = recorder
      let nextId = 1
      let destroyed = false

      const rejectAll = (reason: string): void => {
        for (const pending of recorder.pending.values()) pending.reject(new Error(reason))
        recorder.pending.clear()
      }

      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.on('will-navigate', (event) => event.preventDefault())
      contents.on('render-process-gone', (_event, details) => {
        if (destroyed) return
        rejectAll(`A janela de gravação encerrou (${details.reason})`)
        sink.crashed(details.reason)
      })
      contents.on('console-message', (event) => {
        if (event.level === 'error' || event.level === 'warning') {
          log?.(`[recorder:${event.level}] ${event.message}`)
        }
      })

      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('A janela de gravação não iniciou')),
          15_000
        )
        const listener = (_event: unknown, message: RecorderEvent): void => {
          if (message.type !== 'ready') return
          clearTimeout(timer)
          ipcMain.off(RECORDER_CHANNELS.event, listener)
          resolve()
        }
        ipcMain.on(RECORDER_CHANNELS.event, listener)
      })

      const session: RecorderSession = {
        send: <C extends RecorderCommandName>(command: Extract<RecorderCommand, { name: C }>) =>
          new Promise<RecorderResults[C]>((resolve, reject) => {
            if (destroyed || contents.isDestroyed()) {
              return reject(new Error('A janela de gravação não está mais disponível'))
            }
            const id = nextId++
            recorder.pending.set(id, {
              resolve: (result) => resolve(result as RecorderResults[C]),
              reject
            })
            const message: RecorderCommandMessage = { id, command }
            contents.send(RECORDER_CHANNELS.command, message)
          }),
        destroy() {
          if (destroyed) return
          destroyed = true
          rejectAll('A janela de gravação foi encerrada')
          if (active === recorder) active = null
          if (!window.isDestroyed()) window.destroy()
        }
      }

      try {
        if (options.pageUrl) await window.loadURL(options.pageUrl)
        else await window.loadFile(options.pageFile)
        await ready
      } catch (error) {
        session.destroy()
        throw error
      }
      return session
    }
  }
}

/** Caminhos da janela de gravação no build (`out/`). */
export function recorderPaths(dirname: string): { preloadPath: string; pageFile: string } {
  return {
    preloadPath: join(dirname, '../preload/recorder.js'),
    pageFile: join(dirname, '../renderer/recorder.html')
  }
}
