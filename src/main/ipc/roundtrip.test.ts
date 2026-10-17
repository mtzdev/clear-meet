import { describe, expect, it } from 'vitest'
import type { AiStatus } from '@shared/ai'
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
  systemAudio: true,
  noteShortcut: 'Ctrl+Shift+Space',
  noteLeadSeconds: 5,
  barPosition: null,
  transcriptionModel: 'gemini-3.5-flash-lite',
  groqTextModel: 'openai/gpt-oss-120b',
  geminiTextModel: 'gemini-3.5-flash-lite',
  resolvedMeetingsDir: 'C:\\Users\\x\\Documents\\ClearMeet'
}

const ok: Result<null> = { ok: true, value: null }

const aiStatus: AiStatus = {
  encryptionAvailable: true,
  keys: { gemini: { configured: true, last4: 'abcd' }, groq: { configured: false, last4: null } }
}

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
    library: {
      search: () =>
        Promise.resolve({ entries: [], total: 0, indexed: 0, skipped: 0, updating: false }),
      refresh: () => Promise.resolve()
    },
    meetings: {
      get: () =>
        Promise.resolve({ ok: false, error: { code: 'not-found', message: 'não existe' } }),
      addNote: () =>
        Promise.resolve({ ok: false, error: { code: 'not-found', message: 'não existe' } }),
      updateNote: () =>
        Promise.resolve({ ok: false, error: { code: 'not-found', message: 'não existe' } }),
      deleteNote: () => Promise.resolve(ok)
    },
    transcript: {
      get: () => Promise.resolve({ ok: true, value: null }),
      start: () => Promise.resolve(ok),
      cancel: () => undefined,
      renameSpeaker: () =>
        Promise.resolve({ ok: false, error: { code: 'not-found', message: 'sem Transcrição' } })
    },
    summary: {
      get: () => Promise.resolve({ ok: true, value: null }),
      start: () => Promise.resolve(ok),
      cancel: () => undefined
    },
    chat: {
      get: () => Promise.resolve({ ok: true, value: { messages: [], pending: null } }),
      send: () => Promise.resolve({ ok: true, value: { user: null, assistantId: 'a1' } }),
      stop: () => undefined,
      clear: () => Promise.resolve(ok)
    },
    ai: {
      getStatus: () => aiStatus,
      setKey: () => Promise.resolve({ ok: true, value: aiStatus }),
      clearKey: () => Promise.resolve(aiStatus),
      testKey: () => Promise.resolve({ ok: true })
    },
    openExternal: () => Promise.resolve(),
    settings: { view: () => settingsView, update: () => Promise.resolve(settingsView) },
    recovery: {
      getReport: () => ({ checkedAt: null, running: false, items: [] }),
      retry: () => Promise.resolve({ checkedAt: 1, running: false, items: [] })
    },
    floating: {
      getInfo: () => ({ shortcut: 'Ctrl+Shift+Space', shortcutRegistered: true }),
      resizeBar: () => undefined,
      showMain: () => undefined,
      openEditor: () => undefined,
      beginNote: () => undefined,
      saveNote: () => Promise.resolve(ok),
      cancelNote: () => undefined
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

  it('os canais das Reuniões e Anotações chegam aos handlers', async () => {
    const { api } = createWiredApi(
      fakeDeps({
        library: {
          search: (query) =>
            Promise.resolve({
              entries: [],
              total: query.text.length,
              indexed: 3,
              skipped: 2,
              updating: false
            }),
          refresh: () => Promise.resolve()
        },
        meetings: {
          get: (id) =>
            Promise.resolve({ ok: false, error: { code: 'not-found', message: `sem ${id}` } }),
          addNote: (folder, offsetMs, text) =>
            Promise.resolve({
              ok: true,
              value: { id: folder, offsetMs, text, createdAt: '2026-10-10T10:00:00.000Z' }
            }),
          updateNote: () => Promise.resolve({ ok: false, error: { code: 'busy', message: 'x' } }),
          deleteNote: (_folder, noteId) =>
            Promise.resolve(
              noteId === 'a' ? ok : { ok: false, error: { code: 'not-found', message: 'x' } }
            )
        }
      })
    )
    expect(
      await api.invoke('library:search', {
        text: 'abc',
        fromMs: null,
        toMs: null,
        sort: 'newest',
        limit: null
      })
    ).toEqual({ entries: [], total: 3, indexed: 3, skipped: 2, updating: false })
    expect(await api.invoke('library:refresh')).toBeNull()
    expect(await api.invoke('meeting:get', { id: 'abc' })).toEqual({
      ok: false,
      error: { code: 'not-found', message: 'sem abc' }
    })
    const added = await api.invoke('meeting:addNote', { folder: 'F', offsetMs: 1500, text: 'oi' })
    expect(added.ok && added.value).toMatchObject({ offsetMs: 1500, text: 'oi' })
    expect(await api.invoke('meeting:deleteNote', { folder: 'F', noteId: 'a' })).toEqual(ok)
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

  it('o contrato de eventos tem os eventos esperados', () => {
    expect(Object.keys(IPC_EVENTS).sort()).toEqual([
      'chat:event',
      'floating:info',
      'library:changed',
      'notes:opened',
      'notes:saved',
      'recording:level',
      'recording:state',
      'recovery:report',
      'summary:changed',
      'transcript:changed'
    ])
  })

  it('os canais de IA e Transcrição chegam aos handlers e o evento chega à UI', async () => {
    const started: [string, boolean][] = []
    const { api, emit } = createWiredApi(
      fakeDeps({
        transcript: {
          get: () => Promise.resolve({ ok: true, value: null }),
          start: (folder, requestSummary) => {
            started.push([folder, requestSummary])
            return Promise.resolve(ok)
          },
          cancel: () => undefined,
          renameSpeaker: () =>
            Promise.resolve({ ok: false, error: { code: 'busy', message: 'transcrevendo' } })
        },
        ai: {
          getStatus: () => aiStatus,
          setKey: (provider) =>
            Promise.resolve({
              ok: true,
              value: { ...aiStatus, encryptionAvailable: provider === 'groq' }
            }),
          clearKey: () => Promise.resolve(aiStatus),
          testKey: (_provider, key) =>
            Promise.resolve(
              key === null
                ? { ok: false, kind: 'invalid-key', message: 'Cole a chave.' }
                : { ok: true }
            )
        }
      })
    )
    expect((await api.invoke('ai:getStatus')).keys.gemini.last4).toBe('abcd')
    expect(await api.invoke('ai:setKey', { provider: 'groq', key: 'x' })).toMatchObject({
      ok: true,
      value: { encryptionAvailable: true }
    })
    expect(await api.invoke('ai:testKey', { provider: 'gemini', key: null })).toMatchObject({
      ok: false,
      kind: 'invalid-key'
    })
    expect(await api.invoke('transcript:start', { folder: 'F', requestSummary: true })).toEqual(ok)
    expect(started).toEqual([['F', true]])
    expect(await api.invoke('transcript:get', { folder: 'F' })).toEqual({ ok: true, value: null })
    expect(await api.invoke('transcript:cancel', { folder: 'F' })).toBeNull()
    expect(
      await api.invoke('transcript:renameSpeaker', { folder: 'F', speakerId: 's1', name: 'Ana' })
    ).toMatchObject({ ok: false, error: { code: 'busy' } })

    const received: string[] = []
    api.on('transcript:changed', (event) => received.push(event.view.status))
    emit('transcript:changed', { meetingId: 'm', folder: 'F', view: { status: 'running' } })
    expect(received).toEqual(['running'])
  })

  it('os canais do Resumo e da Conversa chegam aos handlers e os eventos chegam à UI', async () => {
    const sent: (string | null)[] = []
    const stopped: string[] = []
    const { api, emit } = createWiredApi(
      fakeDeps({
        summary: {
          get: () => Promise.resolve({ ok: true, value: null }),
          start: () => Promise.resolve(ok),
          cancel: () => undefined
        },
        chat: {
          get: () => Promise.resolve({ ok: true, value: { messages: [], pending: null } }),
          send: (_folder, text) => {
            sent.push(text)
            return Promise.resolve({ ok: true, value: { user: null, assistantId: 'a1' } })
          },
          stop: (folder) => {
            stopped.push(folder)
          },
          clear: () => Promise.resolve(ok)
        }
      })
    )
    expect(await api.invoke('summary:get', { folder: 'F' })).toEqual({ ok: true, value: null })
    expect(await api.invoke('summary:start', { folder: 'F' })).toEqual(ok)
    expect(await api.invoke('summary:cancel', { folder: 'F' })).toBeNull()
    expect(await api.invoke('chat:get', { folder: 'F' })).toEqual({
      ok: true,
      value: { messages: [], pending: null }
    })
    expect(
      await api.invoke('chat:send', { folder: 'F', text: 'Quais as decisões?' })
    ).toMatchObject({ ok: true, value: { assistantId: 'a1' } })
    await api.invoke('chat:send', { folder: 'F', text: null })
    expect(sent).toEqual(['Quais as decisões?', null])
    expect(await api.invoke('chat:stop', { folder: 'F' })).toBeNull()
    expect(stopped).toEqual(['F'])
    expect(await api.invoke('chat:clear', { folder: 'F' })).toEqual(ok)

    const received: string[] = []
    api.on('summary:changed', (event) => received.push(event.view.status))
    api.on('chat:event', (event) => received.push(event.type))
    emit('summary:changed', {
      meetingId: 'm',
      folder: 'F',
      view: { status: 'running', error: null, provider: null, model: null, updatedAt: null }
    })
    emit('chat:event', { type: 'delta', meetingId: 'm', messageId: 'a1', text: 'oi' })
    expect(received).toEqual(['running', 'delta'])
  })
})
