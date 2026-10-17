import type { FfmpegTools, RunProcess } from '../ffmpeg/media'
import { runProcess } from '../ffmpeg/media'
import { parseEncoders } from '../ffmpeg/probe'

/** Do mais rápido ao reserva: hardware primeiro, `libsvtav1` (CPU) por último. */
export const AV1_ENCODERS = ['av1_nvenc', 'av1_qsv', 'av1_amf', 'libsvtav1'] as const
export type Av1Encoder = (typeof AV1_ENCODERS)[number]

const TEST_TIMEOUT_MS = 20_000

/** Um encode curto de verdade: encoder listado no build mas sem a placa correspondente falha aqui. */
async function canEncode(
  tools: FfmpegTools,
  encoder: Av1Encoder,
  run: RunProcess
): Promise<boolean> {
  const result = await run(
    tools.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=1280x720:rate=15',
      '-c:v',
      encoder,
      '-f',
      'null',
      '-'
    ],
    { timeoutMs: TEST_TIMEOUT_MS }
  )
  return result.code === 0
}

/** Primeiro encoder AV1 que funciona nesta máquina, ou `null` se nenhum. */
export async function detectAv1Encoder(
  tools: FfmpegTools,
  run: RunProcess = runProcess
): Promise<Av1Encoder | null> {
  const listing = await run(tools.ffmpegPath, ['-hide_banner', '-encoders'], {
    timeoutMs: TEST_TIMEOUT_MS
  })
  if (listing.code !== 0) return null
  const listed = parseEncoders(listing.stdout)
  for (const encoder of AV1_ENCODERS) {
    if (!listed.has(encoder)) continue
    if (await canEncode(tools, encoder, run)) return encoder
  }
  return null
}

/** Detecta uma vez por execução do app (por caminho de FFmpeg) e guarda o resultado. */
export class Av1EncoderDetector {
  private readonly cache = new Map<string, Promise<Av1Encoder | null>>()

  constructor(private readonly run: RunProcess = runProcess) {}

  get(tools: FfmpegTools): Promise<Av1Encoder | null> {
    let found = this.cache.get(tools.ffmpegPath)
    if (!found) {
      found = detectAv1Encoder(tools, this.run).catch(() => null)
      this.cache.set(tools.ffmpegPath, found)
    }
    return found
  }
}
