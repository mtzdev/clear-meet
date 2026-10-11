import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEETING_FILES, type MeetingFile } from '@shared/meeting'
import type { MediaInfo } from '../ffmpeg/media'
import { createFakeMedia, FAKE_TOOLS } from './fake-media'
import { applyFinalize, finalizeParts, mediaDurationSec, validateMedia } from './finalize'

const info = (patch: Partial<MediaInfo> = {}): MediaInfo => ({
  formatName: 'mov,mp4',
  durationSec: 10,
  sizeBytes: 1000,
  streams: [],
  ...patch
})

const stream = (patch: Partial<MediaInfo['streams'][number]>): MediaInfo['streams'][number] => ({
  type: 'other',
  codec: null,
  width: null,
  height: null,
  channels: null,
  sampleRate: null,
  durationSec: null,
  startTimeSec: null,
  ...patch
})

describe('validateMedia', () => {
  it('Vídeo precisa de trilha de vídeo com resolução e duração', () => {
    const good = info({
      streams: [stream({ type: 'video', codec: 'h264', width: 1920, height: 1080 })]
    })
    expect(validateMedia(good, 'video')).toBeNull()
    expect(validateMedia(info(), 'video')).toContain('trilha de vídeo')
    expect(
      validateMedia(info({ streams: [stream({ type: 'video', codec: 'h264' })] }), 'video')
    ).toContain('resolução')
    expect(validateMedia({ ...good, durationSec: null }, 'video')).toContain('duração')
  })

  it('Áudio da reunião precisa de trilha Opus e duração', () => {
    const good = info({ streams: [stream({ type: 'audio', codec: 'opus' })] })
    expect(validateMedia(good, 'audio')).toBeNull()
    expect(validateMedia(info(), 'audio')).toContain('trilha de áudio')
    expect(
      validateMedia(info({ streams: [stream({ type: 'audio', codec: 'aac' })] }), 'audio')
    ).toContain('aac')
    expect(validateMedia({ ...good, durationSec: 0 }, 'audio')).toContain('duração')
  })
})

describe('mediaDurationSec', () => {
  it('usa a duração do contêiner, ou a maior das trilhas', () => {
    expect(mediaDurationSec(info({ durationSec: 12.5 }))).toBe(12.5)
    expect(
      mediaDurationSec(
        info({
          durationSec: null,
          streams: [stream({ durationSec: 3 }), stream({ durationSec: 7 })]
        })
      )
    ).toBe(7)
    expect(mediaDurationSec(info({ durationSec: null }))).toBeNull()
  })
})

describe('finalizeParts (ffmpeg e ffprobe falsos)', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'clearmeet-finalize-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  const exists = (name: string): Promise<boolean> =>
    access(join(folder, name)).then(
      () => true,
      () => false
    )

  async function writeParts(video = true): Promise<void> {
    if (video) await writeFile(join(folder, MEETING_FILES.videoPart), 'dados do video')
    await writeFile(join(folder, MEETING_FILES.audioPart), 'dados do audio')
  }

  it('remuxa os dois arquivos, valida e só então apaga os pedaços', async () => {
    await writeParts()
    const fake = createFakeMedia({ durationSec: 42.5 })
    const outcome = await finalizeParts(folder, FAKE_TOOLS, fake.run)

    expect(outcome).toMatchObject({
      video: 'ok',
      audio: 'ok',
      videoSize: { width: 1920, height: 1080 },
      durationMs: 42_500,
      issues: []
    })
    expect((await readdir(folder)).sort()).toEqual(['audio.opus', 'video.mp4'])

    // Ordem: remux -> ffprobe -> (só então) o pedaço some.
    const kinds = fake.calls.map(([file]) =>
      file === FAKE_TOOLS.ffmpegPath ? 'ffmpeg' : 'ffprobe'
    )
    expect(kinds).toEqual(['ffmpeg', 'ffprobe', 'ffmpeg', 'ffprobe'])
  })

  it('só áudio: não procura o vídeo', async () => {
    await writeParts(false)
    const outcome = await finalizeParts(folder, FAKE_TOOLS, createFakeMedia().run)
    expect(outcome).toMatchObject({ video: 'absent', audio: 'ok', videoSize: null })
    expect(await readdir(folder)).toEqual(['audio.opus'])
  })

  it('falha no remux do Vídeo: mantém o pedaço e segue com o áudio', async () => {
    await writeParts()
    const outcome = await finalizeParts(
      folder,
      FAKE_TOOLS,
      createFakeMedia({ failRemux: 'video' }).run
    )
    expect(outcome.video).toBe('failed')
    expect(outcome.audio).toBe('ok')
    expect(outcome.issues[0]).toContain('Vídeo')
    expect(await exists(MEETING_FILES.videoPart)).toBe(true)
    expect(await exists('video.tmp.mp4')).toBe(false)
    expect(await exists(MEETING_FILES.video)).toBe(false)
  })

  it('arquivo remuxado inválido (sem trilha de áudio) não substitui nem apaga o pedaço', async () => {
    await writeParts(false)
    const run = createFakeMedia().run
    const brokenProbe: typeof run = async (file, args) => {
      const result = await run(file, args)
      return file === FAKE_TOOLS.ffprobePath
        ? { ...result, stdout: JSON.stringify({ format: { duration: '5' }, streams: [] }) }
        : result
    }
    const outcome = await finalizeParts(folder, FAKE_TOOLS, brokenProbe)
    expect(outcome.audio).toBe('failed')
    expect(await exists(MEETING_FILES.audioPart)).toBe(true)
    expect(await exists(MEETING_FILES.audio)).toBe(false)
  })

  it('Vídeo sem nenhum quadro vira "ausente" e o Áudio da reunião continua valendo', async () => {
    await writeParts()
    const outcome = await finalizeParts(
      folder,
      FAKE_TOOLS,
      createFakeMedia({ videoWithoutFrames: true }).run
    )
    expect(outcome.video).toBe('absent')
    expect(outcome.audio).toBe('ok')
    expect(outcome.issues).toEqual(['Nenhum quadro de vídeo foi gravado.'])
    expect(await readdir(folder)).toEqual(['audio.opus'])
  })

  it('é idempotente: rodar de novo sobre uma pasta já finalizada confirma os arquivos', async () => {
    await writeParts()
    const fake = createFakeMedia({ durationSec: 8 })
    await finalizeParts(folder, FAKE_TOOLS, fake.run)
    const again = await finalizeParts(folder, FAKE_TOOLS, fake.run)
    expect(again).toMatchObject({ video: 'ok', audio: 'ok', durationMs: 8000 })
  })

  it('pedaços vazios (gravação interrompida antes do primeiro pedaço) = ausente', async () => {
    await writeFile(join(folder, MEETING_FILES.videoPart), '')
    await writeFile(join(folder, MEETING_FILES.audioPart), '')
    const outcome = await finalizeParts(folder, FAKE_TOOLS, createFakeMedia().run)
    expect(outcome).toMatchObject({ video: 'absent', audio: 'absent', durationMs: null })
  })
})

describe('applyFinalize', () => {
  const base: MeetingFile = {
    schemaVersion: 1,
    id: 'id',
    name: 'Reunião',
    createdAt: '2026-10-10T17:00:00.000Z',
    endedAt: null,
    durationMs: 99,
    status: 'processing',
    source: { kind: 'window', name: 'Janela' },
    quality: '1080p',
    video: { file: 'video.mp4', width: 1920, height: 1080, fps: 15 },
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: []
  }
  const outcome = {
    video: 'ok' as const,
    audio: 'ok' as const,
    videoSize: { width: 1280, height: 688 },
    durationMs: 60_000,
    issues: []
  }

  it('tudo certo: pronta, com o tamanho e a duração reais', () => {
    const result = applyFinalize(base, outcome, '2026-10-10T17:01:00.000Z')
    expect(result).toMatchObject({
      status: 'ready',
      durationMs: 60_000,
      endedAt: '2026-10-10T17:01:00.000Z',
      video: { file: 'video.mp4', width: 1280, height: 688, fps: 15 },
      audio: { file: 'audio.opus' }
    })
  })

  it('mantém o endedAt já gravado e a duração do relógio se o ffprobe não mediu', () => {
    const result = applyFinalize(
      { ...base, endedAt: '2026-10-10T17:00:30.000Z' },
      { ...outcome, durationMs: null },
      'ignorado'
    )
    expect(result.endedAt).toBe('2026-10-10T17:00:30.000Z')
    expect(result.durationMs).toBe(99)
  })

  it('falha em algum arquivo: não finalizada, mantendo o que era esperado', () => {
    const result = applyFinalize(base, { ...outcome, video: 'failed', videoSize: null }, 'x')
    expect(result.status).toBe('unprocessed')
    expect(result.video).toEqual(base.video)
  })

  it('sem vídeo gravado: video vira null; sem áudio: audio vira null', () => {
    const noVideo = applyFinalize(base, { ...outcome, video: 'absent', videoSize: null }, 'x')
    expect(noVideo.status).toBe('ready')
    expect(noVideo.video).toBeNull()
    const noAudio = applyFinalize(base, { ...outcome, audio: 'absent' }, 'x')
    expect(noAudio.audio).toBeNull()
  })
})
