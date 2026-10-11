import { execFile } from 'node:child_process'
import { getFfmpegStatus, type StatusOptions } from './status'

/** Caminhos do `ffmpeg` e do `ffprobe` prontos para uso. */
export interface FfmpegTools {
  ffmpegPath: string
  ffprobePath: string
}

export interface ProcessResult {
  /** Código de saída; `null` se o processo nem iniciou ou foi morto por timeout. */
  code: number | null
  stdout: string
  stderr: string
}

/** Executa um binário e devolve o resultado, mesmo quando o código de saída não é zero. Injetável para testes. */
export type RunProcess = (
  file: string,
  args: string[],
  options?: { timeoutMs?: number }
) => Promise<ProcessResult>

const DEFAULT_TIMEOUT_MS = 10 * 60_000

export const runProcess: RunProcess = (file, args, options = {}) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ code: 0, stdout, stderr })
        const code = typeof error.code === 'number' ? error.code : null
        resolve({ code, stdout, stderr: stderr || error.message })
      }
    )
  })

/** FFmpeg + ffprobe utilizáveis agora, ou `null` (não instalado, inválido ou sem ffprobe). */
export async function resolveFfmpegTools(options: StatusOptions): Promise<FfmpegTools | null> {
  const status = await getFfmpegStatus(options)
  if (!status.available || !status.ffmpegPath || !status.ffprobePath) return null
  return { ffmpegPath: status.ffmpegPath, ffprobePath: status.ffprobePath }
}

export interface MediaStreamInfo {
  type: 'video' | 'audio' | 'other'
  codec: string | null
  width: number | null
  height: number | null
  channels: number | null
  sampleRate: number | null
  durationSec: number | null
  startTimeSec: number | null
}

export interface MediaInfo {
  formatName: string | null
  durationSec: number | null
  sizeBytes: number | null
  streams: MediaStreamInfo[]
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Interpreta a saída JSON do `ffprobe -show_format -show_streams`. Lança se não for JSON válido. */
export function parseProbeJson(text: string): MediaInfo {
  const raw = JSON.parse(text) as {
    format?: Record<string, unknown>
    streams?: Record<string, unknown>[]
  }
  const format = raw.format ?? {}
  const streams = (raw.streams ?? []).map((stream): MediaStreamInfo => {
    const type = stream.codec_type
    return {
      type: type === 'video' || type === 'audio' ? type : 'other',
      codec: str(stream.codec_name),
      width: num(stream.width),
      height: num(stream.height),
      channels: num(stream.channels),
      sampleRate: num(stream.sample_rate),
      durationSec: num(stream.duration),
      startTimeSec: num(stream.start_time)
    }
  })
  return {
    formatName: str(format.format_name),
    durationSec: num(format.duration),
    sizeBytes: num(format.size),
    streams
  }
}

/** `ffprobe` de um arquivo. Lança com o motivo se falhar. */
export async function probeMedia(
  tools: FfmpegTools,
  file: string,
  run: RunProcess = runProcess
): Promise<MediaInfo> {
  const result = await run(
    tools.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { timeoutMs: 60_000 }
  )
  if (result.code !== 0) throw new Error(`ffprobe falhou: ${tail(result.stderr)}`)
  return parseProbeJson(result.stdout)
}

function tail(text: string, lines = 4): string {
  return (
    text
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .slice(-lines)
      .join(' | ') || 'sem detalhes'
  )
}

/**
 * Copia as trilhas sem recodificar (`-c copy`) para um arquivo novo: corrige duração e
 * metadados do MP4/WebM fragmentado do Chromium. `kind` escolhe o contêiner de saída:
 * `video` -> MP4 com `+faststart`; `audio` -> Ogg Opus (extensão `.opus`).
 */
export async function remuxFile(
  tools: FfmpegTools,
  input: string,
  output: string,
  kind: 'video' | 'audio',
  run: RunProcess = runProcess
): Promise<void> {
  const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input]
  const args =
    kind === 'video'
      ? [...common, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', output]
      : [...common, '-map', '0:a', '-c', 'copy', '-f', 'opus', output]
  const result = await run(tools.ffmpegPath, args)
  if (result.code !== 0) throw new Error(`ffmpeg falhou: ${tail(result.stderr)}`)
}
