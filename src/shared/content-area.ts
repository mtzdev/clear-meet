/**
 * Área útil de um Vídeo: o retângulo sem as faixas pretas (Vídeos gravados com o canvas maior
 * que a fonte). Detectada pelo main com o FFmpeg; usada pelo player (enquadramento) e pela
 * Compactação (`crop`). Contas puras, sem DOM nem Electron.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ContentArea extends Rect {
  /** Tamanho do quadro em que a área foi medida; só vale para um Vídeo com esse tamanho. */
  frameWidth: number
  frameHeight: number
}

/** Pontos do Vídeo (fração da duração) onde a área é medida. */
export const SAMPLE_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9] as const

/** Amostras válidas mínimas para aceitar a detecção. */
export const MIN_SAMPLES = 4

/** Folga em volta da união das amostras (px): bordas quase pretas do conteúdo não são cortadas. */
const PADDING = 2

/** A área precisa tirar pelo menos isto da largura ou da altura (fração) para valer a pena. */
const MIN_REMOVED = 0.06
/** Área menor que isto do quadro (por eixo) é tratada como detecção errada. */
const MIN_KEPT = 0.2

/** As amostras concordam se cada borda fica a no máximo isto da borda da união (px). */
export function agreementTolerance(frameDimension: number): number {
  return Math.max(16, Math.round(frameDimension * 0.02))
}

/** Último `crop=w:h:x:y` da saída do `cropdetect` (que acumula ao longo dos quadros lidos). */
export function parseCropdetect(output: string): Rect | null {
  let last: Rect | null = null
  for (const match of output.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)) {
    const [width, height, x, y] = [match[1], match[2], match[3], match[4]].map(Number)
    if (width !== undefined && height !== undefined && x !== undefined && y !== undefined) {
      last = { x, y, width, height }
    }
  }
  return last && last.width > 0 && last.height > 0 ? last : null
}

function evenFloor(value: number): number {
  const floored = Math.floor(value)
  return floored - (floored % 2)
}

/**
 * Decide a área útil a partir das amostras. Aceita só se pelo menos `MIN_SAMPLES` amostras
 * concordam entre si e a área é bem menor que o quadro; a área devolvida é a união das
 * amostras (nunca corta o que alguma delas viu), com medidas pares. Qualquer dúvida
 * (conteúdo escuro legítimo, amostras que divergem) devolve `null`: nada é cortado.
 */
export function decideContentArea(
  samples: readonly (Rect | null)[],
  frameWidth: number,
  frameHeight: number
): ContentArea | null {
  if (!(frameWidth > 0) || !(frameHeight > 0)) return null
  const valid = samples.filter((sample): sample is Rect => sample !== null)
  if (valid.length < MIN_SAMPLES) return null

  const left = Math.min(...valid.map((s) => s.x))
  const top = Math.min(...valid.map((s) => s.y))
  const right = Math.max(...valid.map((s) => s.x + s.width))
  const bottom = Math.max(...valid.map((s) => s.y + s.height))

  const toleranceX = agreementTolerance(frameWidth)
  const toleranceY = agreementTolerance(frameHeight)
  const agree = valid.every(
    (s) =>
      s.x - left <= toleranceX &&
      right - (s.x + s.width) <= toleranceX &&
      s.y - top <= toleranceY &&
      bottom - (s.y + s.height) <= toleranceY
  )
  if (!agree) return null

  const x = Math.max(0, evenFloor(left - PADDING))
  const y = Math.max(0, evenFloor(top - PADDING))
  const width = Math.min(frameWidth - x, evenFloor(right + PADDING - x))
  const height = Math.min(frameHeight - y, evenFloor(bottom + PADDING - y))
  if (width < frameWidth * MIN_KEPT || height < frameHeight * MIN_KEPT) return null

  const removedEnough =
    width <= frameWidth * (1 - MIN_REMOVED) || height <= frameHeight * (1 - MIN_REMOVED)
  if (!removedEnough) return null
  return { x, y, width, height, frameWidth, frameHeight }
}

/** Filtro `crop` do FFmpeg para a área. */
export function cropFilter(area: Rect): string {
  return `crop=${area.width}:${area.height}:${area.x}:${area.y}`
}

/** A área só vale para um Vídeo com o mesmo tamanho de quadro em que foi medida. */
export function areaMatchesFrame(area: ContentArea, width: number, height: number): boolean {
  return area.frameWidth === width && area.frameHeight === height
}

export function isContentArea(value: unknown): value is ContentArea {
  if (typeof value !== 'object' || value === null) return false
  const area = value as Record<string, unknown>
  return (
    ['x', 'y', 'width', 'height', 'frameWidth', 'frameHeight'].every(
      (key) => typeof area[key] === 'number' && Number.isFinite(area[key])
    ) &&
    (area['width'] as number) > 0 &&
    (area['height'] as number) > 0
  )
}
