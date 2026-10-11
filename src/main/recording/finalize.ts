import { access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CAPTURE_FPS } from '@shared/capture'
import { MEETING_FILES, type MeetingFile } from '@shared/meeting'
import { removeWithRetry, renameWithRetry } from '../fs/atomic'
import {
  probeMedia,
  remuxFile,
  runProcess,
  type FfmpegTools,
  type MediaInfo,
  type RunProcess
} from '../ffmpeg/media'

/** Por arquivo: pronto, sem conteúdo (nada a fazer) ou com falha (pedaços mantidos). */
export type PartOutcome = 'ok' | 'absent' | 'failed'

export interface FinalizeOutcome {
  video: PartOutcome
  audio: PartOutcome
  videoSize: { width: number; height: number } | null
  /** Duração do arquivo final (do Áudio da reunião, se existir; senão do Vídeo). */
  durationMs: number | null
  issues: string[]
}

type Kind = 'video' | 'audio'

const FILES = {
  video: { part: MEETING_FILES.videoPart, final: MEETING_FILES.video, tmp: 'video.tmp.mp4' },
  audio: { part: MEETING_FILES.audioPart, final: MEETING_FILES.audio, tmp: 'audio.tmp.opus' }
} as const

const NO_VIDEO_TRACK = 'o arquivo não tem trilha de vídeo'

/** Duração do arquivo: a do contêiner ou, na falta, a maior das trilhas. */
export function mediaDurationSec(info: MediaInfo): number | null {
  const candidates = [info.durationSec, ...info.streams.map((stream) => stream.durationSec)]
  const valid = candidates.filter((value): value is number => value !== null && value > 0)
  return valid.length > 0 ? Math.max(...valid) : null
}

/**
 * Confere o arquivo remuxado. Devolve o problema encontrado ou `null` se está bom:
 * o Vídeo precisa ter uma trilha de vídeo, o Áudio da reunião uma trilha Opus, e ambos duração > 0.
 */
export function validateMedia(info: MediaInfo, kind: Kind): string | null {
  if (kind === 'video') {
    const video = info.streams.find((stream) => stream.type === 'video')
    if (!video) return NO_VIDEO_TRACK
    if (!video.width || !video.height) return 'a trilha de vídeo não tem resolução'
  } else {
    const audio = info.streams.find((stream) => stream.type === 'audio')
    if (!audio) return 'o arquivo não tem trilha de áudio'
    if (audio.codec !== 'opus') {
      return `codec de áudio inesperado (${audio.codec ?? 'desconhecido'})`
    }
  }
  if (mediaDurationSec(info) === null) return 'duração desconhecida'
  return null
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface PartResult {
  outcome: PartOutcome
  info: MediaInfo | null
  issue: string | null
}

async function finalizePart(
  folder: string,
  kind: Kind,
  tools: FfmpegTools,
  run: RunProcess
): Promise<PartResult> {
  const names = FILES[kind]
  const part = join(folder, names.part)
  const final = join(folder, names.final)
  const tmp = join(folder, names.tmp)
  const label = kind === 'video' ? 'Vídeo' : 'Áudio da reunião'

  if ((await fileSize(part)) === 0) {
    // Sem pedaços: ou já foi finalizado antes (recuperação repetida) ou nunca gravou nada.
    if (!(await exists(final))) return { outcome: 'absent', info: null, issue: null }
    try {
      const info = await probeMedia(tools, final, run)
      const problem = validateMedia(info, kind)
      return problem
        ? { outcome: 'failed', info: null, issue: `${label}: ${problem}` }
        : { outcome: 'ok', info, issue: null }
    } catch (error) {
      return { outcome: 'failed', info: null, issue: `${label}: ${messageOf(error)}` }
    }
  }

  try {
    await remuxFile(tools, part, tmp, kind, run)
    const info = await probeMedia(tools, tmp, run)
    const problem = validateMedia(info, kind)
    if (problem) {
      await removeWithRetry(tmp)
      // Vídeo sem nenhum quadro (janela minimizada o tempo todo): o Áudio da reunião segue valendo.
      if (kind === 'video' && problem === NO_VIDEO_TRACK) {
        await removeWithRetry(part)
        return { outcome: 'absent', info: null, issue: 'Nenhum quadro de vídeo foi gravado.' }
      }
      return { outcome: 'failed', info: null, issue: `${label}: ${problem}` }
    }
    await renameWithRetry(tmp, final)
    // Só agora, com o arquivo final validado e no lugar, o pedaço pode ir embora.
    await removeWithRetry(part)
    return { outcome: 'ok', info, issue: null }
  } catch (error) {
    await removeWithRetry(tmp).catch(() => undefined)
    return { outcome: 'failed', info: null, issue: `${label}: ${messageOf(error)}` }
  }
}

/**
 * Pós-gravação: remuxa os pedaços (`-c copy`, `+faststart`) para `video.mp4` e `audio.opus`,
 * valida cada resultado com `ffprobe` e só então apaga o pedaço correspondente. Idempotente:
 * pode rodar de novo sobre uma pasta já finalizada ou parcialmente finalizada (recuperação).
 */
export async function finalizeParts(
  folder: string,
  tools: FfmpegTools,
  run: RunProcess = runProcess
): Promise<FinalizeOutcome> {
  const video = await finalizePart(folder, 'video', tools, run)
  const audio = await finalizePart(folder, 'audio', tools, run)

  const videoStream = video.info?.streams.find((stream) => stream.type === 'video')
  const durationSec =
    (audio.info ? mediaDurationSec(audio.info) : null) ??
    (video.info ? mediaDurationSec(video.info) : null)

  return {
    video: video.outcome,
    audio: audio.outcome,
    videoSize:
      videoStream?.width && videoStream.height
        ? { width: videoStream.width, height: videoStream.height }
        : null,
    durationMs: durationSec === null ? null : Math.round(durationSec * 1000),
    issues: [video.issue, audio.issue].filter((issue): issue is string => issue !== null)
  }
}

/** Atualiza o `meeting.json` com o resultado do pós-processamento. Função pura. */
export function applyFinalize(
  meeting: MeetingFile,
  outcome: FinalizeOutcome,
  fallbackEndedAt: string
): MeetingFile {
  const failed = outcome.video === 'failed' || outcome.audio === 'failed'
  const video =
    outcome.video === 'ok' && outcome.videoSize
      ? {
          file: MEETING_FILES.video,
          width: outcome.videoSize.width,
          height: outcome.videoSize.height,
          fps: meeting.video?.fps ?? CAPTURE_FPS
        }
      : outcome.video === 'failed'
        ? meeting.video
        : null
  const audio =
    outcome.audio === 'ok'
      ? { file: MEETING_FILES.audio }
      : outcome.audio === 'failed'
        ? meeting.audio
        : null
  return {
    ...meeting,
    status: failed ? 'unprocessed' : 'ready',
    video,
    audio,
    durationMs: outcome.durationMs ?? meeting.durationMs,
    endedAt: meeting.endedAt ?? fallbackEndedAt
  }
}
