import {
  decideContentArea,
  parseCropdetect,
  SAMPLE_POSITIONS,
  type ContentArea,
  type Rect
} from '@shared/content-area'
import { probeMedia, runProcess, type FfmpegTools, type RunProcess } from '../ffmpeg/media'

const SAMPLE_TIMEOUT_MS = 30_000
/** Quadros lidos em cada ponto (o `cropdetect` acumula a união deles). */
const FRAMES_PER_SAMPLE = 8

export interface DetectOptions {
  run?: RunProcess
  signal?: AbortSignal
}

/**
 * Mede a área útil do Vídeo em alguns pontos espalhados com o `cropdetect` do FFmpeg.
 * Devolve `null` se não há faixas pretas consistentes, se a leitura falha ou se foi cancelada.
 */
export async function detectContentArea(
  tools: FfmpegTools,
  videoPath: string,
  options: DetectOptions = {}
): Promise<ContentArea | null> {
  const run = options.run ?? runProcess
  const info = await probeMedia(tools, videoPath, run)
  const video = info.streams.find((stream) => stream.type === 'video')
  const duration = info.durationSec ?? video?.durationSec ?? null
  if (!video?.width || !video.height || duration === null || !(duration > 0)) return null

  const samples: (Rect | null)[] = []
  for (const position of SAMPLE_POSITIONS) {
    if (options.signal?.aborted) return null
    const result = await run(
      tools.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-ss',
        (duration * position).toFixed(3),
        '-i',
        videoPath,
        '-an',
        '-frames:v',
        String(FRAMES_PER_SAMPLE),
        '-vf',
        'cropdetect=limit=24:round=2:reset=0',
        '-f',
        'null',
        '-'
      ],
      { timeoutMs: SAMPLE_TIMEOUT_MS, signal: options.signal }
    )
    samples.push(result.code === 0 ? parseCropdetect(result.stderr) : null)
  }
  if (options.signal?.aborted) return null
  return decideContentArea(samples, video.width, video.height)
}
