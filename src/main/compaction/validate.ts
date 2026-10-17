import {
  probeMedia,
  runProcess,
  type FfmpegTools,
  type MediaInfo,
  type RunProcess
} from '../ffmpeg/media'

/** Diferença máxima de duração aceita entre o original e o compactado. */
export const MAX_DURATION_DRIFT_SEC = 1
const DECODE_SECONDS = 3
const DECODE_TIMEOUT_MS = 60_000

export type Validation = { ok: true; info: MediaInfo } | { ok: false; reason: string }

function fail(reason: string): Validation {
  return { ok: false, reason }
}

async function decodes(
  tools: FfmpegTools,
  file: string,
  window: string[],
  run: RunProcess
): Promise<boolean> {
  const result = await run(
    tools.ffmpegPath,
    ['-hide_banner', '-loglevel', 'error', '-nostdin', ...window, '-i', file, '-f', 'null', '-'],
    { timeoutMs: DECODE_TIMEOUT_MS }
  )
  return result.code === 0
}

/**
 * Confere o arquivo compactado antes de ele substituir o original: duração igual (±1 s),
 * vídeo AV1, áudio presente se o original tinha e um trecho do início e do fim que decodifica.
 */
export async function validateCompacted(
  tools: FfmpegTools,
  original: MediaInfo,
  output: string,
  run: RunProcess = runProcess
): Promise<Validation> {
  let info: MediaInfo
  try {
    info = await probeMedia(tools, output, run)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  if (!info.streams.some((stream) => stream.type === 'video' && stream.codec === 'av1')) {
    return fail('o arquivo compactado não tem vídeo AV1')
  }
  if (
    original.streams.some((stream) => stream.type === 'audio') &&
    !info.streams.some((stream) => stream.type === 'audio')
  ) {
    return fail('o arquivo compactado perdeu o áudio')
  }
  if (original.durationSec === null || info.durationSec === null) {
    return fail('não foi possível medir a duração')
  }
  if (Math.abs(info.durationSec - original.durationSec) > MAX_DURATION_DRIFT_SEC) {
    return fail(
      `a duração mudou (${original.durationSec.toFixed(1)} s para ${info.durationSec.toFixed(1)} s)`
    )
  }
  if (!(await decodes(tools, output, ['-t', String(DECODE_SECONDS)], run))) {
    return fail('o início do arquivo compactado não decodifica')
  }
  if (!(await decodes(tools, output, ['-sseof', `-${DECODE_SECONDS}`], run))) {
    return fail('o fim do arquivo compactado não decodifica')
  }
  return { ok: true, info }
}
