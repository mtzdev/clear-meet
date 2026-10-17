import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompactionChangedEvent, CompactionMeta } from '@shared/compaction'
import { MEETING_SCHEMA_VERSION, type MeetingFile } from '@shared/meeting'
import { IDLE_STATE } from '@shared/recording'
import type { ProcessResult, RunProcess } from '../ffmpeg/media'
import { readMeeting, writeMeeting } from '../meetings/repository'
import type { Av1Encoder } from './encoders'
import type { RunCompression } from './run'
import { CompactionService, type CompactionDeps } from './service'

const tools = { ffmpegPath: 'ffmpeg.exe', ffprobePath: 'ffprobe.exe' }
const ok: ProcessResult = { code: 0, stdout: '', stderr: '' }
const ORIGINAL_BYTES = 1000

// O antivírus do Windows às vezes segura um arquivo recém-gravado e a escrita atômica retenta.
vi.setConfig({ testTimeout: 20_000 })

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-compaction-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function meetingFile(
  name: string,
  compaction?: CompactionMeta,
  overrides: Partial<MeetingFile> = {}
): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: name,
    name,
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: '2026-10-10T18:00:00.000Z',
    durationMs: 600_000,
    status: 'ready',
    source: { kind: 'screen', name: null },
    quality: '1080p',
    video: {
      file: 'video.mp4',
      width: 1920,
      height: 1080,
      fps: 15,
      ...(compaction ? { compaction } : {})
    },
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [{ id: 'n', offsetMs: 1, text: 'nota', createdAt: '2026-10-10T17:31:00.000Z' }],
    issues: [],
    ...overrides
  }
}

async function createMeeting(
  name: string,
  options: { compaction?: CompactionMeta; video?: boolean; meeting?: Partial<MeetingFile> } = {}
): Promise<string> {
  const folder = join(root, name)
  await mkdir(folder)
  await writeMeeting(folder, meetingFile(name, options.compaction, options.meeting))
  if (options.video !== false)
    await writeFile(join(folder, 'video.mp4'), 'o'.repeat(ORIGINAL_BYTES))
  await writeFile(join(folder, 'audio.opus'), 'a')
  return folder
}

const probeJson = (codec: string): string =>
  JSON.stringify({
    format: { duration: '600' },
    streams: [
      { codec_type: 'video', codec_name: codec },
      { codec_type: 'audio', codec_name: 'opus' }
    ]
  })

interface Options {
  enabled?: boolean
  canRun?: boolean
  /** Tamanho do arquivo que o "FFmpeg" gera. */
  outputBytes?: number
  originalCodec?: string
  /** Encoders cuja codificação falha. */
  failEncoders?: string[]
  encoder?: Av1Encoder
  decodeFails?: boolean
  rename?: CompactionDeps['rename']
  replaceRetryMs?: number
  maxReplaceAttempts?: number
  /** A codificação só termina quando o sinal de parada chega. */
  hang?: boolean
}

function setup(options: Options = {}) {
  const state = { enabled: options.enabled ?? true, canRun: options.canRun ?? true }
  const events: CompactionChangedEvent[] = []
  const changed: string[] = []
  const encodes: Av1Encoder[] = []
  let started: (() => void) | null = null
  const whenStarted = new Promise<void>((resolve) => {
    started = resolve
  })

  const run: RunProcess = (file, args) => {
    if (file === tools.ffprobePath) {
      const path = args[args.length - 1] as string
      const codec = path.endsWith('video.compacting.mp4')
        ? 'av1'
        : (options.originalCodec ?? 'h264')
      return Promise.resolve({ ...ok, stdout: probeJson(codec) })
    }
    return Promise.resolve(options.decodeFails ? { code: 1, stdout: '', stderr: 'erro' } : ok)
  }

  const runCompression: RunCompression = async (_file, args, opts) => {
    const encoder = args[args.indexOf('-c:v') + 1] as Av1Encoder
    encodes.push(encoder)
    started?.()
    if (options.hang) {
      await new Promise<void>((resolve) => {
        if (opts.signal.aborted) resolve()
        opts.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return { code: null, stderr: '', aborted: true }
    }
    if (options.failEncoders?.includes(encoder)) {
      return { code: 1, stderr: 'No capable devices found', aborted: false }
    }
    opts.onProgress(300_000)
    opts.onProgress(450_000)
    await writeFile(args[args.length - 1] as string, 'c'.repeat(options.outputBytes ?? 300))
    return { code: 0, stderr: '', aborted: false }
  }

  const service = new CompactionService({
    meetingsDir: () => root,
    getTools: () => Promise.resolve(tools),
    enabled: () => state.enabled,
    mode: () => 'speed',
    canRun: () => state.canRun,
    detector: { get: () => Promise.resolve(options.encoder ?? 'libsvtav1') },
    emit: (event) => events.push(event),
    onFolderChanged: (folder) => changed.push(folder),
    run,
    runCompression,
    ...(options.rename ? { rename: options.rename } : {}),
    replaceRetryMs: options.replaceRetryMs ?? 5,
    ...(options.maxReplaceAttempts ? { maxReplaceAttempts: options.maxReplaceAttempts } : {}),
    now: () => Date.parse('2026-10-16T12:00:00.000Z'),
    log: () => undefined
  })
  return { service, state, events, changed, encodes, whenStarted }
}

async function metaOf(folder: string): Promise<CompactionMeta | undefined> {
  const read = await readMeeting(folder)
  return read.ok ? read.value.video?.compaction : undefined
}

async function size(path: string): Promise<number> {
  return (await stat(path)).size
}

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const limit = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > limit) throw new Error('tempo esgotado esperando a condição')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('CompactionService', () => {
  it('compacta, valida e troca o video.mp4 pelo menor, sem deixar temporário', async () => {
    const folder = await createMeeting('a')
    const { service, events, changed } = setup({ outputBytes: 300 })
    await service.enqueueFolder(folder)
    await service.idle()

    expect(await size(join(folder, 'video.mp4'))).toBe(300)
    expect(await readdir(folder)).not.toContain('video.compacting.mp4')
    expect(await metaOf(folder)).toMatchObject({
      status: 'done',
      codec: 'av1',
      encoder: 'libsvtav1',
      originalBytes: ORIGINAL_BYTES,
      finalBytes: 300
    })
    expect(events.map((event) => [event.status, event.percent])).toEqual([
      ['running', 0],
      ['running', 50],
      ['running', 75],
      ['running', 100],
      ['done', null]
    ])
    expect(changed).toContain(folder)
    const read = await readMeeting(folder)
    expect(read.ok && read.value.notes).toHaveLength(1)
  })

  it('regra "manter o menor": se não ficou menor, o original fica e o temporário é descartado', async () => {
    const folder = await createMeeting('a')
    const { service } = setup({ outputBytes: ORIGINAL_BYTES + 50 })
    await service.enqueueFolder(folder)
    await service.idle()

    expect(await readFile(join(folder, 'video.mp4'), 'utf8')).toBe('o'.repeat(ORIGINAL_BYTES))
    expect(await readdir(folder)).not.toContain('video.compacting.mp4')
    expect(await metaOf(folder)).toMatchObject({
      status: 'kept-original',
      originalBytes: ORIGINAL_BYTES,
      finalBytes: ORIGINAL_BYTES + 50
    })
    // Mantida não volta para a fila.
    const again = setup()
    await again.service.enqueueFolder(folder)
    expect(again.service.isIdle).toBe(true)
  })

  it('arquivo compactado que não passa na validação nunca substitui o original', async () => {
    const folder = await createMeeting('a')
    const { service } = setup({ decodeFails: true })
    await service.enqueueFolder(folder)
    await service.idle()

    expect(await readFile(join(folder, 'video.mp4'), 'utf8')).toBe('o'.repeat(ORIGINAL_BYTES))
    expect(await readdir(folder)).not.toContain('video.compacting.mp4')
    expect(await metaOf(folder)).toMatchObject({ status: 'error' })
  })

  it('encoder de hardware que falha cai para o libsvtav1', async () => {
    const folder = await createMeeting('a')
    const { service, encodes } = setup({ encoder: 'av1_nvenc', failEncoders: ['av1_nvenc'] })
    await service.enqueueFolder(folder)
    await service.idle()

    expect(encodes).toEqual(['av1_nvenc', 'libsvtav1'])
    expect(await metaOf(folder)).toMatchObject({ status: 'done', encoder: 'libsvtav1' })
  })

  it('erro de compactação deixa o original e permite tentar de novo', async () => {
    const folder = await createMeeting('a')
    const failing = setup({ failEncoders: ['libsvtav1'] })
    await failing.service.enqueueFolder(folder)
    await failing.service.idle()
    expect(await metaOf(folder)).toMatchObject({ status: 'error' })
    expect(await size(join(folder, 'video.mp4'))).toBe(ORIGINAL_BYTES)

    // Erro não volta sozinho...
    const idle = setup()
    await idle.service.enqueueFolder(folder)
    expect(idle.service.isIdle).toBe(true)
    // ...mas volta a pedido do usuário.
    expect(await idle.service.retry(folder)).toEqual({ ok: true, value: null })
    await idle.service.idle()
    expect(await metaOf(folder)).toMatchObject({ status: 'done' })
  })

  it('Vídeo já em AV1 é marcado como concluído sem recodificar', async () => {
    const folder = await createMeeting('a')
    const { service, encodes } = setup({ originalCodec: 'av1' })
    await service.enqueueFolder(folder)
    await service.idle()
    expect(encodes).toEqual([])
    expect(await metaOf(folder)).toMatchObject({ status: 'done', codec: 'av1' })
  })

  describe('troca do arquivo em uso', () => {
    it('rename falha por arquivo em uso: nada se perde e a troca é tentada de novo depois', async () => {
      const folder = await createMeeting('a')
      let failures = 2
      const { service, events } = setup({
        rename: async (from, to) => {
          if (failures-- > 0) throw Object.assign(new Error('em uso'), { code: 'EBUSY' })
          const { rename } = await import('node:fs/promises')
          await rename(from, to)
        }
      })
      await service.enqueueFolder(folder)
      await service.idle()

      // Primeira tentativa falhou: o original está intacto e o temporário aguarda.
      expect(await readFile(join(folder, 'video.mp4'), 'utf8')).toBe('o'.repeat(ORIGINAL_BYTES))
      expect(await readdir(folder)).toContain('video.compacting.mp4')
      expect(service.isActive(folder)).toBe(true)
      expect(await metaOf(folder)).toMatchObject({ status: 'running' })

      await until(() => events.some((event) => event.status === 'done'))
      expect(await size(join(folder, 'video.mp4'))).toBe(300)
      expect(await readdir(folder)).not.toContain('video.compacting.mp4')
      expect(service.isActive(folder)).toBe(false)
    })

    it('desiste depois de muitas tentativas: original intacto, temporário apagado, erro registrado', async () => {
      const folder = await createMeeting('a')
      const { service, events } = setup({
        maxReplaceAttempts: 3,
        rename: () => Promise.reject(Object.assign(new Error('em uso'), { code: 'EBUSY' }))
      })
      await service.enqueueFolder(folder)
      await service.idle()
      await until(() => events.some((event) => event.status === 'error'))
      expect(await metaOf(folder)).toMatchObject({ status: 'error' })

      expect(await readFile(join(folder, 'video.mp4'), 'utf8')).toBe('o'.repeat(ORIGINAL_BYTES))
      expect(await readdir(folder)).not.toContain('video.compacting.mp4')
      expect(service.isActive(folder)).toBe(false)
    })
  })

  describe('recuperação', () => {
    it('ao abrir, apaga o temporário e devolve a Reunião interrompida para a fila', async () => {
      const folder = await createMeeting('a', {
        compaction: { status: 'running', updatedAt: '2026-10-16T11:00:00.000Z' }
      })
      await writeFile(join(folder, 'video.compacting.mp4'), 'parcial')

      // Com a Compactação desligada só se limpa e se volta para "pendente".
      const off = setup({ enabled: false })
      await off.service.start()
      expect(await readdir(folder)).not.toContain('video.compacting.mp4')
      expect(await metaOf(folder)).toMatchObject({ status: 'pending' })
      expect(await size(join(folder, 'video.mp4'))).toBe(ORIGINAL_BYTES)

      const on = setup()
      await on.service.start()
      await on.service.idle()
      expect(await metaOf(folder)).toMatchObject({ status: 'done' })
    })

    it('Reuniões antigas (sem registro) entram na fila; concluídas, mantidas, sem Vídeo ou não prontas, não', async () => {
      const old = await createMeeting('antiga')
      const done = await createMeeting('feita', {
        compaction: { status: 'done', updatedAt: '2026-10-01T00:00:00.000Z' }
      })
      const kept = await createMeeting('mantida', {
        compaction: { status: 'kept-original', updatedAt: '2026-10-01T00:00:00.000Z' }
      })
      const noVideo = await createMeeting('sem-video', {
        video: false,
        meeting: { video: null, source: { kind: 'none', name: null } }
      })
      const unfinished = await createMeeting('pendente', { meeting: { status: 'unprocessed' } })

      const { service } = setup()
      await service.start()
      await service.idle()

      expect(await size(join(old, 'video.mp4'))).toBe(300)
      for (const untouched of [done, kept, unfinished]) {
        expect(await size(join(untouched, 'video.mp4'))).toBe(ORIGINAL_BYTES)
      }
      expect(await readdir(noVideo)).not.toContain('video.mp4')
    })
  })

  describe('fila e gravação', () => {
    it('não processa enquanto a gravação precisa da máquina e retoma depois', async () => {
      const folder = await createMeeting('a')
      const { service, state, encodes } = setup({ canRun: false })
      await service.enqueueFolder(folder)
      await service.idle()
      expect(encodes).toEqual([])
      expect(await metaOf(folder)).toBeUndefined()

      state.canRun = true
      service.onRecordingState(IDLE_STATE)
      await service.idle()
      expect(await metaOf(folder)).toMatchObject({ status: 'done' })
    })

    it('a gravação que começa interrompe a Compactação em curso, que volta para a fila', async () => {
      const folder = await createMeeting('a')
      const { service, state, whenStarted, encodes } = setup({ hang: true })
      await service.enqueueFolder(folder)
      await whenStarted
      expect(service.isActive(folder)).toBe(true)

      state.canRun = false
      service.onRecordingState({ phase: 'starting' })
      await service.idle()

      expect(service.isActive(folder)).toBe(false)
      expect(await readdir(folder)).not.toContain('video.compacting.mp4')
      expect(await size(join(folder, 'video.mp4'))).toBe(ORIGINAL_BYTES)
      expect(await metaOf(folder)).toMatchObject({ status: 'pending' })
      expect(encodes).toEqual(['libsvtav1'])
      expect(service.isIdle).toBe(false)
    })

    it('desligar a Compactação para a em curso e esvazia a fila; ligar enfileira as pendentes', async () => {
      const folder = await createMeeting('a')
      const { service, state, whenStarted } = setup({ hang: true })
      await service.enqueueFolder(folder)
      await whenStarted

      state.enabled = false
      service.onSettingsChanged()
      await service.idle()
      expect(service.isIdle).toBe(true)
      expect(await metaOf(folder)).toMatchObject({ status: 'pending' })
      expect(await size(join(folder, 'video.mp4'))).toBe(ORIGINAL_BYTES)

      // Desligada, nada entra na fila.
      await service.enqueueFolder(folder)
      expect(service.isIdle).toBe(true)
    })

    it('ao fim da gravação, a Reunião nova entra na fila', async () => {
      const folder = await createMeeting('nova')
      const { service, events } = setup()
      service.onRecordingState({
        phase: 'idle',
        finished: {
          meetingId: 'nova',
          folder,
          name: 'nova',
          durationMs: 600_000,
          status: 'ready',
          hasVideo: true,
          hasAudioInput: true,
          reason: 'user',
          issue: null
        }
      })
      await until(() => events.some((event) => event.status === 'done'))
      expect(await metaOf(folder)).toMatchObject({ status: 'done' })
    })
  })

  it('uma Reunião por vez: a segunda só começa quando a primeira termina', async () => {
    const a = await createMeeting('a')
    const b = await createMeeting('b')
    const { service, encodes } = setup()
    await service.enqueueFolder(a)
    await service.enqueueFolder(b)
    await service.idle()
    expect(encodes).toHaveLength(2)
    expect((await metaOf(a))?.status).toBe('done')
    expect((await metaOf(b))?.status).toBe('done')
  })
})
