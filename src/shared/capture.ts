/**
 * Parâmetros e contas puras da captura (sem DOM nem Electron, para poder testar).
 * Usado pelo main (bitrate, pastas) e pela janela de gravação (canvas, encaixe).
 */

export const QUALITY_PRESETS = ['720p', '1080p', 'native'] as const
/** Preset de qualidade: 720p, 1080p (padrão) ou resolução da fonte ("nativa"). */
export type QualityPreset = (typeof QUALITY_PRESETS)[number]

export const DEFAULT_QUALITY: QualityPreset = '1080p'

export function isQualityPreset(value: unknown): value is QualityPreset {
  return typeof value === 'string' && (QUALITY_PRESETS as readonly string[]).includes(value)
}

/** Teto de quadros por segundo do Vídeo (ADR 0003). */
export const CAPTURE_FPS = 15

/** Opus mono do Áudio da reunião (~32 kbps; o mp4 do Chromium ignora e grava ~96 kbps). */
export const AUDIO_BITS_PER_SECOND = 32_000

/** Intervalo dos pedaços (`timeslice`) entregues ao disco, em ms. */
export const CHUNK_INTERVAL_MS = 3000

export interface Size {
  width: number
  height: number
}

const PRESET_SIZES: Record<Exclude<QualityPreset, 'native'>, Size> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 }
}

/**
 * Limite da resolução "nativa": 4K (3840x2160). Acima disso a fonte é reduzida
 * (mantendo a proporção) para o encoder de hardware e o disco darem conta.
 */
export const NATIVE_MAX: Size = { width: 3840, height: 2160 }

/** Menor lado aceito pelo canvas (evita canvas minúsculo se a fonte reportar tamanho absurdo). */
const MIN_DIMENSION = 16

function evenFloor(value: number): number {
  const floored = Math.floor(value)
  return floored - (floored % 2)
}

/**
 * Tamanho do canvas, e portanto do MP4, que não muda durante a gravação.
 * - 720p / 1080p: o tamanho do preset, sempre (a fonte é encaixada dentro dele).
 * - nativa: o tamanho da fonte no início, par (exigência do H.264) e limitado a `NATIVE_MAX`.
 */
export function resolveCanvasSize(preset: QualityPreset, source: Size | null): Size {
  if (preset !== 'native') return PRESET_SIZES[preset]
  if (!source || !(source.width > 0) || !(source.height > 0)) return PRESET_SIZES['1080p']
  const shrink = Math.min(1, NATIVE_MAX.width / source.width, NATIVE_MAX.height / source.height)
  return {
    width: Math.max(MIN_DIMENSION, evenFloor(source.width * shrink)),
    height: Math.max(MIN_DIMENSION, evenFloor(source.height * shrink))
  }
}

/** Restrição de tamanho máximo pedida ao `getDisplayMedia` (a captura já chega reduzida). */
export function captureMaxSize(preset: QualityPreset): Size {
  return preset === 'native' ? NATIVE_MAX : PRESET_SIZES[preset]
}

export interface Fit {
  /** Retângulo onde o quadro da fonte é desenhado dentro do canvas. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * Encaixe com letterbox: a fonte é reduzida para caber no canvas mantendo a
 * proporção, **nunca ampliada** (texto de janela pequena não fica borrado) e centralizada.
 */
export function computeFit(source: Size, canvas: Size): Fit {
  if (!(source.width > 0) || !(source.height > 0)) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  }
  const scale = Math.min(1, canvas.width / source.width, canvas.height / source.height)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  return {
    x: Math.round((canvas.width - width) / 2),
    y: Math.round((canvas.height - height) / 2),
    width,
    height
  }
}

/** Bitrate de referência em 1080p (bits/s), por modo de Compactação (ADR 0003). */
const BITRATE_1080P = { compaction: 4_000_000, plain: 2_000_000 } as const
const BITRATE_720P = { compaction: 2_000_000, plain: 1_000_000 } as const
const BITRATE_MAX = 12_000_000
const BITRATE_MIN = 1_000_000

/**
 * Teto de bitrate do Vídeo ao vivo (o encoder de hardware usa só uma parte dele).
 * Com Compactação ligada grava com folga (o AV1 só reduz bem se o H.264 de entrada
 * tem qualidade sobrando); desligada, moderado. Na resolução nativa escala com o
 * número de pixels em relação a 1080p, entre 1 e 12 Mbps.
 */
export function videoBitrate(preset: QualityPreset, canvas: Size, compaction: boolean): number {
  const mode = compaction ? 'compaction' : 'plain'
  if (preset === '720p') return BITRATE_720P[mode]
  if (preset === '1080p') return BITRATE_1080P[mode]
  const pixels = (canvas.width * canvas.height) / (1920 * 1080)
  const scaled = Math.round((BITRATE_1080P[mode] * pixels) / 100_000) * 100_000
  return Math.min(BITRATE_MAX, Math.max(BITRATE_MIN, scaled))
}

/**
 * Limitador de quadros por segundo (teto de 15 fps). Os quadros da captura chegam com jitter
 * (a 15 fps nominais, intervalos de 50 a 85 ms); cortar por "intervalo mínimo desde o último
 * quadro" descartaria um terço deles. Aqui os quadros aceitos seguem uma grade de `1/fps` e
 * cada um pode chegar até `slack` de intervalo antes do previsto. Uma fonte mais rápida
 * (30 ou 60 fps) é reduzida a `fps`; uma fonte a ~`fps` passa quase inteira; depois de uma
 * lacuna (janela minimizada) a grade recomeça no próximo quadro.
 */
export class FrameRateLimiter {
  private nextDueUs = Number.NEGATIVE_INFINITY
  private readonly intervalUs: number

  constructor(
    fps: number,
    private readonly slack = 0.5
  ) {
    this.intervalUs = 1e6 / fps
  }

  /** `timestampUs`: carimbo do quadro (microssegundos). `true` = manter o quadro. */
  accept(timestampUs: number): boolean {
    if (timestampUs < this.nextDueUs - this.intervalUs * this.slack) return false
    const onGrid = timestampUs - this.nextDueUs < this.intervalUs
    this.nextDueUs = (onGrid ? this.nextDueUs : timestampUs) + this.intervalUs
    return true
  }
}
