import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEETING_SCHEMA_VERSION, type MeetingFile } from '@shared/meeting'
import type { ProcessResult, RunProcess } from '../ffmpeg/media'
import { writeMeeting } from '../meetings/repository'
import { ContentAreaService } from './service'

const tools = { ffmpegPath: 'ffmpeg.exe', ffprobePath: 'ffprobe.exe' }

vi.setConfig({ testTimeout: 20_000 })

let root: string
let cache: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-area-'))
  cache = join(root, '.cache')
  await mkdir(join(root, 'a'))
  const meeting: MeetingFile = {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: 'a',
    name: 'a',
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: '2026-10-10T18:00:00.000Z',
    durationMs: 600_000,
    status: 'ready',
    source: { kind: 'screen', name: null },
    quality: '1080p',
    video: { file: 'video.mp4', width: 1920, height: 1080, fps: 15 },
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: []
  }
  await writeMeeting(join(root, 'a'), meeting)
  await writeFile(join(root, 'a', 'video.mp4'), 'video')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const PROBE = JSON.stringify({
  format: { duration: '600' },
  streams: [{ codec_type: 'video', codec_name: 'av1', width: 1920, height: 1080 }]
})

function setup(options: { crop?: string; canRun?: boolean } = {}) {
  const calls = { ffmpeg: 0 }
  const state = { canRun: options.canRun ?? true }
  const run: RunProcess = (file) => {
    if (file === tools.ffprobePath) {
      return Promise.resolve<ProcessResult>({ code: 0, stdout: PROBE, stderr: '' })
    }
    calls.ffmpeg += 1
    return Promise.resolve<ProcessResult>({
      code: 0,
      stdout: '',
      stderr: `[Parsed_cropdetect_0 @ 0] crop=${options.crop ?? '1364:768:278:156'}`
    })
  }
  const service = new ContentAreaService({
    meetingsDir: () => root,
    cacheDir: cache,
    getTools: () => Promise.resolve(tools),
    canRun: () => state.canRun,
    run
  })
  return { service, calls, state }
}

describe('ContentAreaService', () => {
  it('mede em vários pontos e devolve a área útil', async () => {
    const { service, calls } = setup()
    const area = await service.get(join(root, 'a'))
    expect(area).toEqual({
      x: 276,
      y: 154,
      width: 1368,
      height: 772,
      frameWidth: 1920,
      frameHeight: 1080
    })
    expect(calls.ffmpeg).toBe(5)
  })

  it('guarda em cache (inclusive "sem faixas") e não mede de novo', async () => {
    const { service, calls } = setup({ crop: '1920:1080:0:0' })
    expect(await service.get(join(root, 'a'))).toBeNull()
    expect(await service.get(join(root, 'a'))).toBeNull()
    expect(calls.ffmpeg).toBe(5)
    expect(await readdir(cache)).toEqual(['a.json'])
  })

  it('mede de novo quando o arquivo do Vídeo muda (Compactação)', async () => {
    const { service, calls } = setup()
    await service.get(join(root, 'a'))
    await writeFile(join(root, 'a', 'video.mp4'), 'video compactado, outro tamanho')
    await service.get(join(root, 'a'))
    expect(calls.ffmpeg).toBe(10)
  })

  it('durante a gravação não mede nem guarda nada', async () => {
    const { service, calls, state } = setup({ canRun: false })
    expect(await service.get(join(root, 'a'))).toBeNull()
    expect(calls.ffmpeg).toBe(0)
    state.canRun = true
    expect(await service.get(join(root, 'a'))).not.toBeNull()
  })

  it('pedidos simultâneos da mesma pasta medem uma vez', async () => {
    const { service, calls } = setup()
    await Promise.all([service.get(join(root, 'a')), service.get(join(root, 'a'))])
    expect(calls.ffmpeg).toBe(5)
  })

  it('recusa pastas fora da pasta das Reuniões', async () => {
    const { service, calls } = setup()
    expect(await service.get(join(root, '..'))).toBeNull()
    expect(calls.ffmpeg).toBe(0)
  })

  it('área minúscula em todas as amostras não vale', async () => {
    const { service } = setup({ crop: '300:200:700:400' })
    // Todas iguais e minúsculas: tratada como erro de detecção.
    expect(await service.get(join(root, 'a'))).toBeNull()
  })
})
