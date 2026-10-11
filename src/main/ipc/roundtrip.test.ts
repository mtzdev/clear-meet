import { describe, expect, it } from 'vitest'
import type { FfmpegStatus } from '@shared/ffmpeg'
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc'
import { IDLE_STATE, type RecordingState, type Result } from '@shared/recording'
import type { SettingsView } from '@shared/settings'
import { createRendererApi, type IpcRendererLike } from '../../preload/api'
import { createIpcHandlers, type HandlerDeps } from './handlers'
import { registerIpcHandlers, type IpcMainLike } from './register'

const status: FfmpegStatus = {
  available: true,
  source: 'vendor',
  ffmpegPath: 'C:\\ffmpeg.exe',
  ffprobePath: 'C:\\ffprobe.exe',
  version: '9.0.2-full_build-www.gyan.dev',
  hasLibSvtAv1: true,
  pinnedVersion: '9.0.2',
  error: null
}

const settingsView: SettingsView = {
  meetingsDir: null,
  compaction: true,
  quality: '1080p',
  videoEncoder: 'software',
  micDeviceId: null,
  resolvedMeetingsDir: 'C:\\Users\\x\\Documents\\ClearMeet'
}

const ok: Result<null> = { ok: true, value: null }

function fakeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getAppVersion: () => '1.2.3',
    getFfmpegStatus: () => Promise.resolve(status),
    listSources: () => Promise.resolve([]),
    preflight: () =>
      Promise.resolve({ meetingsDir: 'C:\\m', freeBytes: 10, disk: 'ok', ffmpegAvailable: true }),
    recording: {
      getState: () => IDLE_STATE,
      start: () => Promise.resolve(ok),
      pause: () => Promise.resolve(ok),
      resume: () => Promise.resolve(ok),
      stop: () =>
        Promise.resolve({ ok: false, error: { code: 'not-recording', message: 'não grava' } }),
      acknowledge: () => Promise.resolve()
    },
    renameMeeting: (folder, name) =>
      Promise.resolve({ ok: true, value: { folder, name, folderRenamed: true } }),
    revealMeeting: () => Promise.resolve(),
    settings: { view: () => settingsView, update: () => Promise.resolve(settingsView) },
    recovery: {
      getReport: () => ({ checkedAt: null, running: false, items: [] }),
      retry: () => Promise.resolve({ checkedAt: 1, running: false, items: [] })
    },
    ...overrides
  }
}

/** Liga um `ipcMain` falso a um `ipcRenderer` falso: o caminho completo do IPC, sem Electron. */
function createWiredApi(deps: HandlerDeps = fakeDeps()) {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const subscribers = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>()
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => {
      if (listeners.has(channel)) throw new Error(`canal duplicado: ${channel}`)
      listeners.set(channel, listener)
    }
  }
  registerIpcHandlers(ipcMain, createIpcHandlers(deps))
  const ipcRenderer: IpcRendererLike = {
    invoke: (channel, ...args) => {
      const listener = listeners.get(channel)
      if (!listener) return Promise.reject(new Error(`No handler registered for '${channel}'`))
      return Promise.resolve(listener({}, ...args))
    },
    on: (channel, listener) => {
      const set = subscribers.get(channel) ?? new Set()
      set.add(listener)
      subscribers.set(channel, set)
    },
    removeListener: (channel, listener) => {
      subscribers.get(channel)?.delete(listener)
    }
  }
  /** Simula o main enviando um evento ao renderer. */
  const emit = (channel: string, payload: unknown): void => {
    for (const listener of subscribers.get(channel) ?? []) listener({ sender: 'main' }, payload)
  }
  return { api: createRendererApi(ipcRenderer), listeners, subscribers, emit }
}

describe('IPC de ponta a ponta (renderer -> preload -> main)', () => {
  it('registra um handler para cada canal do contrato', () => {
    const { listeners } = createWiredApi()
    expect([...listeners.keys()].sort()).toEqual(Object.keys(IPC_CHANNELS).sort())
  })

  it('app:getVersion devolve a versão', async () => {
    const { api } = createWiredApi()
    const version: string = await api.invoke('app:getVersion')
    expect(version).toBe('1.2.3')
  })

  it('ffmpeg:status devolve o estado tipado', async () => {
    const { api } = createWiredApi()
    const result: FfmpegStatus = await api.invoke('ffmpeg:status')
    expect(result).toEqual(status)
  })

  it('canais com pedido repassam o argumento ao handler', async () => {
    const { api } = createWiredApi()
    const result = await api.invoke('meeting:rename', { folder: 'C:\\m\\a', name: 'Novo' })
    expect(result).toEqual({
      ok: true,
      value: { folder: 'C:\\m\\a', name: 'Novo', folderRenamed: true }
    })
  })

  it('erros previstos voltam como Result, não como exceção', async () => {
    const { api } = createWiredApi()
    const result = await api.invoke('recording:stop')
    expect(result).toEqual({ ok: false, error: { code: 'not-recording', message: 'não grava' } })
  })

  it('o preload recusa canais fora do contrato', async () => {
    const { api } = createWiredApi()
    const untyped = api as unknown as { invoke(channel: string): Promise<unknown> }
    await expect(untyped.invoke('shell:exec')).rejects.toThrow('Canal IPC desconhecido')
  })

  it('eventos do main chegam ao renderer só com o conteúdo, e dá para cancelar a inscrição', () => {
    const { api, emit, subscribers } = createWiredApi()
    const received: RecordingState[] = []
    const off = api.on('recording:state', (state) => received.push(state))

    emit('recording:state', { phase: 'starting' })
    expect(received).toEqual([{ phase: 'starting' }])

    off()
    emit('recording:state', IDLE_STATE)
    expect(received).toHaveLength(1)
    expect(subscribers.get('recording:state')?.size).toBe(0)
  })

  it('o preload recusa eventos fora do contrato', () => {
    const { api } = createWiredApi()
    const untyped = api as unknown as { on(event: string, listener: () => void): () => void }
    expect(() => untyped.on('secret:event', () => undefined)).toThrow('Evento IPC desconhecido')
  })

  it('o contrato de eventos tem os três eventos esperados', () => {
    expect(Object.keys(IPC_EVENTS).sort()).toEqual([
      'recording:level',
      'recording:state',
      'recovery:report'
    ])
  })
})
