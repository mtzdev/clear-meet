import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readdir, readFile, rm, stat, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MEETING_FILES } from '@shared/meeting'
import { FFMPEG_BUILD } from '../ffmpeg/config'
import { probeMedia, runProcess, type FfmpegTools } from '../ffmpeg/media'
import { resolveFfmpeg } from '../ffmpeg/paths'
import { finalizeParts } from './finalize'

/**
 * Integração com o FFmpeg de verdade (o de `npm run fetch:ffmpeg` ou `FFMPEG_PATH`).
 * Sem ele, estes testes são ignorados. Gera mídia sintética no formato que o Chromium produz
 * (MP4 fragmentado H.264+Opus e WebM Opus) e confere o pós-gravação de ponta a ponta.
 */
const resolved = resolveFfmpeg({
  env: process.env,
  downloadedRoot: join(tmpdir(), 'clearmeet-sem-ffmpeg'),
  vendorRoot: resolve(__dirname, '../../../vendor/ffmpeg'),
  version: FFMPEG_BUILD.version
})
const tools: FfmpegTools | null =
  resolved && resolved.ffprobePath
    ? { ffmpegPath: resolved.ffmpegPath, ffprobePath: resolved.ffprobePath }
    : null

describe.skipIf(!tools)('pós-gravação com FFmpeg real', () => {
  let fixtures: string
  let work: string

  beforeAll(async () => {
    if (!tools) return
    fixtures = await mkdtemp(join(tmpdir(), 'clearmeet-fixtures-'))
    const ffmpeg = (...args: string[]): void => {
      execFileSync(tools.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
        windowsHide: true
      })
    }
    // MP4 fragmentado, como o `MediaRecorder` do Chromium grava.
    ffmpeg(
      ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'],
      ...['-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-ac', '1'],
      ...['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'],
      join(fixtures, 'video.part.mp4')
    )
    ffmpeg(
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'],
      ...['-t', '4', '-c:a', 'libopus', '-ac', '1', '-b:a', '32k', '-f', 'webm'],
      join(fixtures, 'audio.part.webm')
    )
  }, 60_000)

  afterAll(async () => {
    await rm(fixtures, { recursive: true, force: true })
  })

  async function freshFolder(): Promise<string> {
    work = await mkdtemp(join(tmpdir(), 'clearmeet-final-'))
    await copyFile(join(fixtures, 'video.part.mp4'), join(work, MEETING_FILES.videoPart))
    await copyFile(join(fixtures, 'audio.part.webm'), join(work, MEETING_FILES.audioPart))
    return work
  }

  it('gera video.mp4 e audio.opus válidos e apaga os pedaços', async () => {
    if (!tools) return
    const folder = await freshFolder()
    try {
      const outcome = await finalizeParts(folder, tools, runProcess)
      expect(outcome).toMatchObject({
        video: 'ok',
        audio: 'ok',
        videoSize: { width: 640, height: 360 },
        issues: []
      })
      expect(outcome.durationMs).toBeGreaterThan(3500)
      expect(outcome.durationMs).toBeLessThan(4500)
      expect((await readdir(folder)).sort()).toEqual(['audio.opus', 'video.mp4'])

      const audio = await probeMedia(tools, join(folder, 'audio.opus'))
      expect(audio.formatName).toBe('ogg') // Ogg Opus: o contêiner certo para a extensão .opus
      expect(audio.streams[0]).toMatchObject({ type: 'audio', codec: 'opus', channels: 1 })
      // Assinatura "OggS" no início do arquivo.
      expect((await readFile(join(folder, 'audio.opus'))).subarray(0, 4).toString('latin1')).toBe(
        'OggS'
      )

      const video = await probeMedia(tools, join(folder, 'video.mp4'))
      expect(video.streams.map((stream) => stream.type).sort()).toEqual(['audio', 'video'])
      expect(video.durationSec).toBeGreaterThan(3.5)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 60_000)

  it('recupera arquivos cortados no meio (como após uma queda do processo)', async () => {
    if (!tools) return
    const folder = await freshFolder()
    try {
      for (const part of [MEETING_FILES.videoPart, MEETING_FILES.audioPart]) {
        const { size } = await stat(join(folder, part))
        await truncate(join(folder, part), Math.floor(size * 0.6))
      }
      const outcome = await finalizeParts(folder, tools, runProcess)
      expect(outcome.audio).toBe('ok')
      expect(outcome.video).toBe('ok')
      expect(outcome.durationMs).toBeGreaterThan(1500)
      expect(outcome.durationMs).toBeLessThan(4000)
      expect((await readdir(folder)).sort()).toEqual(['audio.opus', 'video.mp4'])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 60_000)

  it('um pedaço que não é mídia falha sem apagar nada', async () => {
    if (!tools) return
    const folder = await freshFolder()
    try {
      await copyFile(join(fixtures, 'audio.part.webm'), join(folder, MEETING_FILES.videoPart)) // webm no lugar do mp4
      await truncate(join(folder, MEETING_FILES.videoPart), 40)
      const outcome = await finalizeParts(folder, tools, runProcess)
      expect(outcome.video).toBe('failed')
      expect(outcome.audio).toBe('ok')
      const names = await readdir(folder)
      expect(names).toContain(MEETING_FILES.videoPart)
      expect(names).not.toContain('video.tmp.mp4')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 60_000)
})
