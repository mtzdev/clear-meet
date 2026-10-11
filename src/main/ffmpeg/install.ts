import { existsSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FFMPEG_BUILD,
  FFMPEG_EXE,
  FFPROBE_EXE,
  selectArchiveEntry,
  type FfmpegBuild
} from './config'
import { renameWithRetry } from '../fs/atomic'
import { downloadFile, type DownloadProgress } from './download'
import { extractZip } from './extract'
import { installDirFor } from './paths'
import { probeFfmpeg, probeFfprobe, runBinary, type RunFn } from './probe'
import { verifySha256 } from './verify'

export type InstallProgress =
  ({ phase: 'download' } & DownloadProgress) | { phase: 'verify' | 'extract' | 'validate' | 'done' }

export interface InstallOptions {
  /** Raiz das instalações; o FFmpeg fica em `<destRoot>/<versão>/`. */
  destRoot: string
  build?: FfmpegBuild
  /** Reinstala mesmo que a versão já esteja presente. */
  force?: boolean
  fetch?: typeof fetch
  signal?: AbortSignal
  onProgress?: (progress: InstallProgress) => void
  /** Valida a instalação ainda na pasta temporária. Padrão: `validateInstall`. */
  validate?: (dir: string) => Promise<void>
}

export interface InstallResult {
  dir: string
  /** `false` quando a versão já estava instalada e nada foi baixado. */
  installed: boolean
}

/** Executa `-version`/`-encoders` e exige `libsvtav1` e um `ffprobe` funcional. */
export async function validateInstall(dir: string, run: RunFn = runBinary): Promise<void> {
  const probe = await probeFfmpeg(join(dir, FFMPEG_EXE), run)
  if (!probe.hasLibSvtAv1) throw new Error('O FFmpeg baixado não tem o encoder libsvtav1')
  await probeFfprobe(join(dir, FFPROBE_EXE), run)
}

export function isInstalled(destRoot: string, version: string): boolean {
  const dir = installDirFor(destRoot, version)
  return existsSync(join(dir, FFMPEG_EXE)) && existsSync(join(dir, FFPROBE_EXE))
}

/**
 * Baixa, verifica e instala o FFmpeg fixado. Escrita atômica: tudo acontece numa
 * pasta temporária ao lado do destino (mesmo volume) e só no final ela é renomeada
 * para `<destRoot>/<versão>/`. Uma falha em qualquer etapa não deixa instalação parcial.
 */
export async function installFfmpeg(options: InstallOptions): Promise<InstallResult> {
  const { destRoot, build = FFMPEG_BUILD, onProgress } = options
  const finalDir = installDirFor(destRoot, build.version)

  if (!options.force && isInstalled(destRoot, build.version)) {
    onProgress?.({ phase: 'done' })
    return { dir: finalDir, installed: false }
  }

  await mkdir(destRoot, { recursive: true })
  // Sobras de instalações interrompidas.
  for (const name of await readdir(destRoot)) {
    if (name.startsWith('.tmp-')) await rm(join(destRoot, name), { recursive: true, force: true })
  }

  const tmpDir = join(destRoot, `.tmp-${build.version}-${process.pid}-${Date.now()}`)
  const extractDir = join(tmpDir, 'extract')
  const archivePath = join(tmpDir, 'ffmpeg.zip')

  try {
    await mkdir(extractDir, { recursive: true })

    await downloadFile(build.url, archivePath, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      onProgress: (progress) => onProgress?.({ phase: 'download', ...progress })
    })

    onProgress?.({ phase: 'verify' })
    await verifySha256(archivePath, build.sha256)

    onProgress?.({ phase: 'extract' })
    const extracted = await extractZip(archivePath, extractDir, selectArchiveEntry)
    for (const required of [FFMPEG_EXE, FFPROBE_EXE]) {
      if (!extracted.includes(required)) throw new Error(`${required} não encontrado no pacote`)
    }

    onProgress?.({ phase: 'validate' })
    await (options.validate ?? ((dir: string) => validateInstall(dir)))(extractDir)

    await rm(finalDir, { recursive: true, force: true })
    await renameWithRetry(extractDir, finalDir)
    onProgress?.({ phase: 'done' })
    return { dir: finalDir, installed: true }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}
