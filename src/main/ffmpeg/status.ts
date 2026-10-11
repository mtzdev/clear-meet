import type { FfmpegStatus } from '@shared/ffmpeg'
import { FFMPEG_BUILD } from './config'
import { resolveFfmpeg, type ResolveOptions } from './paths'
import { probeFfmpeg, probeFfprobe, runBinary, type RunFn } from './probe'

export type StatusOptions = Omit<ResolveOptions, 'version'> & { run?: RunFn }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve o FFmpeg e o executa para confirmar versão, `libsvtav1` e `ffprobe`. Nunca lança. */
export async function getFfmpegStatus(options: StatusOptions): Promise<FfmpegStatus> {
  const pinnedVersion = FFMPEG_BUILD.version
  const run = options.run ?? runBinary
  const base: FfmpegStatus = {
    available: false,
    source: null,
    ffmpegPath: null,
    ffprobePath: null,
    version: null,
    hasLibSvtAv1: false,
    pinnedVersion,
    error: null
  }

  const resolved = resolveFfmpeg({ ...options, version: pinnedVersion })
  if (!resolved) return { ...base, error: 'FFmpeg não instalado' }

  const found: FfmpegStatus = {
    ...base,
    source: resolved.source,
    ffmpegPath: resolved.ffmpegPath,
    ffprobePath: resolved.ffprobePath
  }
  if (!resolved.ffprobePath) return { ...found, error: 'ffprobe não encontrado ao lado do ffmpeg' }

  try {
    const probe = await probeFfmpeg(resolved.ffmpegPath, run)
    found.version = probe.version
    found.hasLibSvtAv1 = probe.hasLibSvtAv1
    await probeFfprobe(resolved.ffprobePath, run)
    return { ...found, available: true }
  } catch (error) {
    return { ...found, error: message(error) }
  }
}
