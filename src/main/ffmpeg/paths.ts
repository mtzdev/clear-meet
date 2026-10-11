import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FfmpegSource } from '@shared/ffmpeg'
import { FFMPEG_EXE, FFPROBE_EXE } from './config'

export interface ResolvedFfmpeg {
  source: FfmpegSource
  ffmpegPath: string
  /** `null` se o `ffprobe` não foi encontrado ao lado do `ffmpeg`. */
  ffprobePath: string | null
}

export interface ResolveOptions {
  env: Readonly<Record<string, string | undefined>>
  /** Pasta onde o app instala o FFmpeg baixado (`<userData>/ffmpeg`). */
  downloadedRoot: string
  /** Pasta do script de dev (`<repo>/vendor/ffmpeg`); `null` fora de desenvolvimento. */
  vendorRoot: string | null
  /** Versão fixada (subpasta de instalação). */
  version: string
  /** Injetável para testes. */
  exists?: (path: string) => boolean
}

/** Pasta de uma instalação: `<raiz>/<versão>/`. */
export function installDirFor(root: string, version: string): string {
  return join(root, version)
}

/**
 * Resolve o caminho do FFmpeg. Ordem:
 * 1. `FFMPEG_PATH` (e `FFPROBE_PATH`, se existir) — se apontar para um arquivo inexistente, é ignorado;
 * 2. binário baixado pelo app em `userData`;
 * 3. `vendor/` (somente em desenvolvimento).
 */
export function resolveFfmpeg(options: ResolveOptions): ResolvedFfmpeg | null {
  const { env, downloadedRoot, vendorRoot, version } = options
  const exists = options.exists ?? existsSync

  const probeNextTo = (ffmpegPath: string, override?: string): string | null => {
    if (override && exists(override)) return override
    const sibling = join(dirname(ffmpegPath), FFPROBE_EXE)
    return exists(sibling) ? sibling : null
  }

  const envPath = env.FFMPEG_PATH
  if (envPath && exists(envPath)) {
    return {
      source: 'env',
      ffmpegPath: envPath,
      ffprobePath: probeNextTo(envPath, env.FFPROBE_PATH)
    }
  }

  const roots: [FfmpegSource, string | null][] = [
    ['downloaded', downloadedRoot],
    ['vendor', vendorRoot]
  ]
  for (const [source, root] of roots) {
    if (!root) continue
    const dir = installDirFor(root, version)
    const ffmpegPath = join(dir, FFMPEG_EXE)
    if (exists(ffmpegPath)) return { source, ffmpegPath, ffprobePath: probeNextTo(ffmpegPath) }
  }
  return null
}
