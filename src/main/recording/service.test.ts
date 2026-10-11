import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clockElapsedMs } from '@shared/clock'
import { MEETING_FILE, MEETING_FILES } from '@shared/meeting'
import type {
  RecorderCommand,
  RecorderCommandName,
  RecorderResults,
  RecorderStarted
} from '@shared/recorder'
import {
  type AudioLevels,
  DISK_ABORT_BYTES,
  DISK_CRITICAL_BYTES,
  DISK_LOW_BYTES,
  type RecordingState,
  type StartRecordingRequest
} from '@shared/recording'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { WindowState } from '../capture/window-state'
import { readMeeting } from '../meetings/repository'
import { createFakeMedia, FAKE_TOOLS } from './fake-media'
import { RecordingService, type RecorderSession, type RecorderSink } from './service'

const T0 = Date.UTC(2026, 9, 10, 17, 0, 0)
const GB = 1024 ** 3

const windowRequest: StartRecordingRequest = {
  source: { kind: 'window', id: 'window:1:0', name: 'Reunião semanal - Meet' },
  mic: { deviceId: 'default', label: 'Microfone' },
  quality: '1080p'
}

const started = (patch: Partial<RecorderStarted> = {}): RecorderStarted => ({
  startedAt: T0 + 50,
  video: {
    width: 1920,
    height: 1080,
    fps: 15,
    mimeType: 'video/mp4;codecs=avc1,opus',
    bitsPerSecond: 4_000_000,
    sourceWidth: 1280,
    sourceHeight: 720
  },
  audioMimeType: 'audio/webm;codecs=opus',
  hasMic: true,
  hasSystemAudio: true,
  micProblem: null,
  ...patch
})

interface Harness {
  service: RecordingService
  dir: string
  sink: () => RecorderSink
  commands: RecorderCommand[]
  states: RecordingState[]
  levels: AudioLevels[]
  now: { value: number }
  free: { value: number | null }
  windowState: { value: WindowState; calls: number[] }
  setStart(result: RecorderStarted | Error): void
  setTools(available: boolean): void
  setSourceAvailable(available: boolean): void
  destroyed: () => number
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-service-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

function createHarness(): Harness {
  const commands: RecorderCommand[] = []
  const states: RecordingState[] = []
  const levels: AudioLevels[] = []
  const now = { value: T0 }
  const free: { value: number | null } = { value: 100 * GB }
  const windowState: Harness['windowState'] = { value: 'normal', calls: [] }
  let startResult: RecorderStarted | Error = started()
  let tools = true
  let sourceAvailable = true
  let sink: RecorderSink | null = null
  let destroyed = 0
  const fake = createFakeMedia({ durationSec: 61.5 })

  const session: RecorderSession = {
    send: <C extends RecorderCommandName>(command: Extract<RecorderCommand, { name: C }>) => {
      commands.push(command)
      switch (command.name) {
        case 'start':
          return (
            startResult instanceof Error
              ? Promise.reject(startResult)
              : Promise.resolve(startResult)
          ) as Promise<RecorderResults[C]>
        case 'pause':
        case 'resume':
          return Promise.resolve({ at: now.value }) as Promise<RecorderResults[C]>
        default:
          return Promise.resolve(null) as Promise<RecorderResults[C]>
      }
    },
    destroy: () => {
      destroyed++
    }
  }

  const service = new RecordingService({
    config: () => ({ settings: DEFAULT_SETTINGS, meetingsDir: root }),
    getTools: () => Promise.resolve(tools ? FAKE_TOOLS : null),
    createRecorder: (newSink) => {
      sink = newSink
      return Promise.resolve(session)
    },
    selectSource: (source) => Promise.resolve(source === null || sourceAvailable),
    emit: (event, payload) => {
      if (event === 'recording:state') states.push(payload as RecordingState)
      else levels.push(payload as AudioLevels)
    },
    freeBytes: () => Promise.resolve(free.value),
    keepAwake: () => () => undefined,
    windowState: (hwnd) => {
      windowState.calls.push(hwnd)
      return windowState.value
    },
    now: () => now.value,
    run: fake.run
  })

  return {
    service,
    dir: root,
    sink: () => {
      if (!sink) throw new Error('gravador ainda não criado')
      return sink
    },
    commands,
    states,
    levels,
    now,
    free,
    windowState,
    setStart: (result) => (startResult = result),
    setTools: (available) => (tools = available),
    setSourceAvailable: (available) => (sourceAvailable = available),
    destroyed: () => destroyed
  }
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

describe('RecordingService: gravação completa', () => {
  it('cria a pasta, grava os pedaços, pausa/retoma e finaliza com Vídeo e Áudio da reunião', async () => {
    const h = createHarness()
    h.now.value = T0
    expect(await h.service.start(windowRequest)).toEqual({ ok: true, value: null })

    const state = h.service.getState()
    expect(state.phase).toBe('recording')
    if (state.phase !== 'recording') return
    expect(state.meeting.name).toBe('Reunião semanal - Meet')
    expect(state.meeting.videoSize).toEqual({ width: 1920, height: 1080 })
    expect(state.warnings).toEqual([])
    // Pasta: AAAA-MM-DD HHMM - Nome (hora local do relógio injetado).
    expect(state.meeting.folder.startsWith(join(root, '20'))).toBe(true)
    expect(state.meeting.folder.endsWith(' - Reunião semanal - Meet')).toBe(true)

    const start = h.commands[0]
    expect(start).toMatchObject({
      name: 'start',
      params: { hasVideo: true, preset: '1080p', compaction: true }
    })

    // Instante zero = início do gravador de áudio.
    expect(state.clock.startedAt).toBe(T0 + 50)

    // Pedaços chegando vão para o disco.
    await h.sink().chunk('video', new Uint8Array([1, 2, 3]).buffer)
    await h.sink().chunk('audio', new Uint8Array([4, 5]).buffer)
    const folder = state.meeting.folder
    expect((await readFile(join(folder, MEETING_FILES.videoPart))).length).toBe(3)
    expect((await readFile(join(folder, MEETING_FILES.audioPart))).length).toBe(2)

    // meeting.json já existe, com status "recording".
    const during = await readMeeting(folder)
    expect(during.ok && during.value).toMatchObject({
      status: 'recording',
      endedAt: null,
      video: { width: 1920, height: 1080 },
      inputs: { mic: true, systemAudio: true }
    })

    // Pausa de 10 s no meio: 20 s gravados antes + 5 s depois = 25 s.
    h.now.value = T0 + 50 + 20_000
    expect(await h.service.pause()).toEqual({ ok: true, value: null })
    const paused = h.service.getState()
    expect(paused.phase).toBe('paused')
    h.now.value += 10_000
    expect(await h.service.resume()).toEqual({ ok: true, value: null })
    h.now.value += 5_000
    const resumed = h.service.getState()
    if (resumed.phase !== 'recording') throw new Error('deveria estar gravando')
    expect(clockElapsedMs(resumed.clock, h.now.value)).toBe(25_000)

    const stopped = await h.service.stop()
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) return
    expect(stopped.value).toMatchObject({
      name: 'Reunião semanal - Meet',
      status: 'ready',
      hasVideo: true,
      reason: 'user',
      durationMs: 61_500, // medido pelo ffprobe (falso), não pelo relógio
      issue: null
    })

    // Fim: pedaços viraram os arquivos finais, meeting.json pronto, estado ocioso com o resultado.
    expect((await readdir(folder)).sort()).toEqual(['audio.opus', 'meeting.json', 'video.mp4'])
    const finalMeeting = await readMeeting(folder)
    expect(finalMeeting.ok && finalMeeting.value).toMatchObject({
      status: 'ready',
      durationMs: 61_500
    })
    expect(finalMeeting.ok && finalMeeting.value.endedAt).toBe(new Date(h.now.value).toISOString())
    expect(h.service.getState()).toMatchObject({
      phase: 'idle',
      finished: { meetingId: stopped.value.meetingId }
    })
    expect(h.destroyed()).toBe(1)
    expect(h.commands.map((command) => command.name)).toEqual(['start', 'pause', 'resume', 'stop'])

    // A UI confirma e o resultado some do estado.
    await h.service.acknowledge()
    expect(h.service.getState()).toEqual({ phase: 'idle', finished: null })
  })

  it('o tempo gravado durante uma pausa não conta, mesmo se parar pausado', async () => {
    const h = createHarness()
    await h.service.start(windowRequest)
    h.now.value = T0 + 50 + 8_000
    await h.service.pause()
    h.now.value += 60_000
    const result = await h.service.stop()
    expect(result.ok).toBe(true)
    const state = h.states.find((candidate) => candidate.phase === 'finalizing')
    expect(state && 'clock' in state && clockElapsedMs(state.clock, h.now.value)).toBe(8_000)
  })

  it('só áudio: sem arquivo de vídeo e o nome sugerido é a data e hora', async () => {
    const h = createHarness()
    h.setStart(started({ video: null }))
    const result = await h.service.start({ source: { kind: 'none' }, mic: null, quality: '1080p' })
    expect(result.ok).toBe(true)
    expect(h.commands[0]).toMatchObject({ params: { hasVideo: false, mic: null } })

    const state = h.service.getState()
    if (state.phase !== 'recording') throw new Error('deveria estar gravando')
    expect(state.meeting.name).toMatch(/^Reunião de \d{2}\/\d{2} \d{2}:\d{2}$/)
    expect(await exists(join(state.meeting.folder, MEETING_FILES.videoPart))).toBe(false)
    // Pedaço de vídeo (que não deveria vir) é ignorado sem erro.
    await h.sink().chunk('video', new Uint8Array([1]).buffer)

    const stopped = await h.service.stop()
    expect(stopped.ok && stopped.value.hasVideo).toBe(false)
  })
})

describe('RecordingService: falhas ao iniciar', () => {
  it('não inicia duas vezes', async () => {
    const h = createHarness()
    await h.service.start(windowRequest)
    const second = await h.service.start(windowRequest)
    expect(!second.ok && second.error.code).toBe('busy')
    expect(h.service.getState().phase).toBe('recording')
  })

  it('pedido malformado vindo da UI é recusado', async () => {
    const h = createHarness()
    const bad = await h.service.start({
      source: { kind: 'window', id: '', name: 'x' },
      mic: null,
      quality: '1080p'
    })
    expect(!bad.ok && bad.error.code).toBe('invalid-request')
    const badQuality = await h.service.start({
      source: { kind: 'none' },
      mic: null,
      quality: '9k' as never
    })
    expect(!badQuality.ok && badQuality.error.code).toBe('invalid-request')
    expect(h.service.getState().phase).toBe('idle')
  })

  it('fonte que sumiu: erro claro e nenhuma pasta criada', async () => {
    const h = createHarness()
    h.setSourceAvailable(false)
    const result = await h.service.start(windowRequest)
    expect(!result.ok && result.error.code).toBe('source-unavailable')
    expect(await readdir(root)).toEqual([])
    expect(h.service.getState()).toEqual({ phase: 'idle', finished: null })
  })

  it('pouco espaço no disco: recusa antes de criar a pasta', async () => {
    const h = createHarness()
    h.free.value = DISK_CRITICAL_BYTES - 1
    const result = await h.service.start(windowRequest)
    expect(!result.ok && result.error.code).toBe('no-disk-space')
    expect(await readdir(root)).toEqual([])
  })

  it('espaço baixo mas suficiente: inicia normalmente', async () => {
    const h = createHarness()
    h.free.value = DISK_LOW_BYTES - 1
    expect((await h.service.start(windowRequest)).ok).toBe(true)
  })

  it('o gravador falha ao iniciar: devolve o erro, fecha tudo e apaga a pasta vazia', async () => {
    const h = createHarness()
    h.setStart(new Error('Não foi possível capturar a tela: permissão negada.'))
    const result = await h.service.start(windowRequest)
    expect(!result.ok && result.error).toEqual({
      code: 'recorder-failed',
      message: 'Não foi possível capturar a tela: permissão negada.'
    })
    expect(await readdir(root)).toEqual([])
    expect(h.destroyed()).toBe(1)
    expect(h.service.getState()).toEqual({ phase: 'idle', finished: null })
    // Dá para tentar de novo.
    h.setStart(started())
    expect((await h.service.start(windowRequest)).ok).toBe(true)
  })

  it('microfone pedido mas indisponível: grava só o sistema e avisa', async () => {
    const h = createHarness()
    h.setStart(started({ hasMic: false, micProblem: 'permissão negada' }))
    await h.service.start(windowRequest)
    const state = h.service.getState()
    expect(state.phase === 'recording' && state.warnings).toEqual(['mic-unavailable'])
    expect(state.phase === 'recording' && state.meeting.hasMic).toBe(false)
  })
})

describe('RecordingService: durante a gravação', () => {
  it('janela minimizada: o aviso aparece e some quando ela é restaurada', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const h = createHarness()
    await h.service.start(windowRequest)
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.service.getState()).toMatchObject({ warnings: [] })
    // O HWND vem do id da Fonte de captura ("window:1:0").
    expect(new Set(h.windowState.calls)).toEqual(new Set([1]))

    h.windowState.value = 'minimized'
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.service.getState()).toMatchObject({ warnings: ['window-minimized'] })
    h.windowState.value = 'normal'
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.service.getState()).toMatchObject({ warnings: [] })
  })

  it('janela que não existe mais não é acusada como minimizada', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const h = createHarness()
    await h.service.start(windowRequest)
    h.windowState.value = 'gone'
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.service.getState()).toMatchObject({ warnings: [] })
  })

  it('tela inteira não consulta o estado de nenhuma janela', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const h = createHarness()
    await h.service.start({
      ...windowRequest,
      source: { kind: 'screen', id: 'screen:0:0', name: 'Tela 1' }
    })
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.windowState.calls).toEqual([])
  })

  it('pausada, a janela minimizada não gera aviso; ao retomar, volta a ser verificada', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const h = createHarness()
    await h.service.start(windowRequest)
    h.windowState.value = 'minimized'
    await h.service.pause()
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.service.getState()).toMatchObject({ phase: 'paused', warnings: [] })
    await h.service.resume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.service.getState()).toMatchObject({
      phase: 'recording',
      warnings: ['window-minimized']
    })
  })

  it('codificador de vídeo travado: avisa, registra no meeting.json e o áudio segue', async () => {
    const h = createHarness()
    await h.service.start(windowRequest)
    const state = h.service.getState()
    if (state.phase !== 'recording') throw new Error('deveria estar gravando')
    h.now.value = T0 + 50 + 42_000
    h.sink().event({ type: 'video-stalled', stalled: true })
    expect(h.service.getState()).toMatchObject({
      phase: 'recording',
      warnings: ['video-encoder-stalled']
    })
    await vi.waitFor(async () => {
      const saved = await readMeeting(state.meeting.folder)
      expect(saved.ok && saved.value.issues).toEqual([
        { code: 'video-encoder-stalled', atMs: 42_000 }
      ])
    })
    h.sink().event({ type: 'video-stalled', stalled: false })
    expect(h.service.getState()).toMatchObject({ warnings: [] })
    // O registro da ocorrência permanece depois de parar.
    const stopped = await h.service.stop()
    expect(stopped.ok).toBe(true)
    const final = await readMeeting(state.meeting.folder)
    expect(final.ok && final.value.issues).toHaveLength(1)
  })

  it('pausar também desfaz o aviso de janela minimizada', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const h = createHarness()
    await h.service.start(windowRequest)
    h.windowState.value = 'minimized'
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.service.getState()).toMatchObject({ warnings: ['window-minimized'] })
    await h.service.pause()
    expect(h.service.getState()).toMatchObject({ phase: 'paused', warnings: [] })
  })

  it('a fonte de vídeo terminou (janela fechada): encerra a gravação com o resultado', async () => {
    const h = createHarness()
    await h.service.start(windowRequest)
    h.sink().event({ type: 'source-ended' })
    await vi.waitFor(() => expect(h.service.getState().phase).toBe('idle'))
    const state = h.service.getState()
    expect(state).toMatchObject({ finished: { reason: 'source-ended', status: 'ready' } })
  })

  it('os níveis de áudio são repassados à UI', async () => {
    const h = createHarness()
    await h.service.start(windowRequest)
    h.sink().event({ type: 'levels', mic: 0.4, system: 0.1 })
    expect(h.levels).toEqual([{ mic: 0.4, system: 0.1 }])
  })

  it('pausar/retomar/parar sem gravação dão erro claro', async () => {
    const h = createHarness()
    for (const result of [
      await h.service.pause(),
      await h.service.resume(),
      await h.service.stop()
    ]) {
      expect(!result.ok && result.error.code).toBe('not-recording')
    }
  })

  it('retomar só funciona se estiver pausada', async () => {
    const h = createHarness()
    await h.service.start(windowRequest)
    const result = await h.service.resume()
    expect(!result.ok && result.error.code).toBe('not-recording')
  })

  it('a janela de gravação morre no meio: finaliza com o que já foi gravado', async () => {
    const h = createHarness()
    await h.service.start(windowRequest)
    await h.sink().chunk('audio', new Uint8Array([1, 2, 3]).buffer)
    h.sink().crashed('crashed')
    await vi.waitFor(() => expect(h.service.getState().phase).toBe('idle'))
    expect(h.service.getState()).toMatchObject({
      finished: { reason: 'recorder-crashed', status: 'ready' }
    })
  })

  it('parar duas vezes seguidas devolve o mesmo resultado', async () => {
    const h = createHarness()
    await h.service.start(windowRequest)
    const [a, b] = await Promise.all([h.service.stop(), h.service.stop()])
    expect(a).toEqual(b)
    expect(h.commands.filter((command) => command.name === 'stop')).toHaveLength(1)
  })
})

describe('RecordingService: monitor de disco', () => {
  it('avisa quando o espaço fica baixo e encerra com segurança perto de acabar', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const h = createHarness()
    await h.service.start(windowRequest)

    h.free.value = DISK_LOW_BYTES - 1
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.service.getState()).toMatchObject({ warnings: ['low-disk'] })

    h.free.value = 50 * GB
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.service.getState()).toMatchObject({ warnings: [] })

    h.free.value = DISK_ABORT_BYTES - 1
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(h.service.getState().phase).toBe('idle'))
    expect(h.service.getState()).toMatchObject({ finished: { reason: 'low-disk' } })
  })
})

describe('RecordingService: pós-processamento que não pôde concluir', () => {
  it('sem FFmpeg: a Reunião fica "unprocessed" com os pedaços preservados para a recuperação', async () => {
    const h = createHarness()
    h.setTools(false)
    await h.service.start(windowRequest)
    const state = h.service.getState()
    if (state.phase !== 'recording') throw new Error('deveria estar gravando')
    await h.sink().chunk('video', new Uint8Array([1, 2, 3]).buffer)
    await h.sink().chunk('audio', new Uint8Array([4, 5, 6]).buffer)

    const result = await h.service.stop()
    expect(result.ok && result.value).toMatchObject({ status: 'unprocessed' })
    expect(result.ok && result.value.issue).toContain('FFmpeg indisponível')

    const folder = state.meeting.folder
    expect((await readdir(folder)).sort()).toEqual(
      [MEETING_FILES.audioPart, MEETING_FILE, MEETING_FILES.videoPart].sort()
    )
    const saved = await readMeeting(folder)
    expect(saved.ok && saved.value.status).toBe('unprocessed')
  })
})
