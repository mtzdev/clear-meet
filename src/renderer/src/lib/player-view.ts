export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point, Size {}

/**
 * Posição da camada do vídeo na área do player: `translate(x, y) scale(scale)` com origem no
 * canto. `scale` é absoluto (1 = vídeo inteiro encaixado na área); o ajuste ("100%") pode
 * ser maior que 1 quando há faixas pretas a esconder.
 */
export interface PlayerView {
  scale: number
  x: number
  y: number
}

/** Medidas que limitam o zoom e o arrasto. */
export interface ViewSpace {
  stage: Size
  /** O que deve ficar à vista: o vídeo todo, ou só a área útil (em coordenadas da área). */
  content: Rect
  /** Escala do ajuste: a menor permitida. */
  minScale: number
}

export const MAX_ZOOM = 8
export const ZOOM_STEP = 1.25
export const DOUBLE_CLICK_ZOOM = 2

const ZOOM_EPSILON = 1.001

function isPositiveSize(size: Size): boolean {
  return size.width > 0 && size.height > 0
}

/**
 * Onde a imagem aparece dentro da área (`object-fit: contain`): inteira, centralizada e
 * com a proporção original. Sem tamanho do vídeo conhecido, vale a área toda.
 */
export function fitRect(video: Size, stage: Size): Rect {
  if (!isPositiveSize(stage)) return { x: 0, y: 0, width: 0, height: 0 }
  if (!isPositiveSize(video)) return { x: 0, y: 0, width: stage.width, height: stage.height }
  const ratio = Math.min(stage.width / video.width, stage.height / video.height)
  const width = video.width * ratio
  const height = video.height * ratio
  return { x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height }
}

/**
 * Limites da visão. Sem `area`, o ajuste mostra o vídeo inteiro; com ela (retângulo em pixels
 * do vídeo, sem as faixas pretas), o ajuste enquadra só essa área.
 */
export function viewSpace(video: Size, stage: Size, area: Rect | null): ViewSpace {
  const fit = fitRect(video, stage)
  if (!area || !isPositiveSize(video) || !isPositiveSize(stage)) {
    return { stage, content: fit, minScale: 1 }
  }
  const ratio = fit.width / video.width
  const content = {
    x: fit.x + area.x * ratio,
    y: fit.y + area.y * ratio,
    width: area.width * ratio,
    height: area.height * ratio
  }
  const minScale = Math.max(1, Math.min(stage.width / content.width, stage.height / content.height))
  return { stage, content, minScale }
}

export function clampScale(scale: number, space: ViewSpace): number {
  if (!Number.isFinite(scale)) return space.minScale
  return Math.min(space.minScale * MAX_ZOOM, Math.max(space.minScale, scale))
}

/** Uma faixa do deslocamento: imagem menor que a área fica centrada; maior, não deixa vazio. */
function clampAxis(
  offset: number,
  scale: number,
  stage: number,
  start: number,
  size: number
): number {
  if (size * scale <= stage) return stage / 2 - scale * (start + size / 2)
  const max = -start * scale
  const min = stage - (start + size) * scale
  // "+ 0" troca o -0 (borda em cima do limite) por 0.
  return Math.min(max, Math.max(min, offset)) + 0
}

/** Mantém o conteúdo cobrindo a área (nunca some nem deixa borda vazia). */
export function clampView(view: PlayerView, space: ViewSpace): PlayerView {
  const { stage, content } = space
  const scale = clampScale(view.scale, space)
  if (!isPositiveSize(stage)) return { scale, x: 0, y: 0 }
  return {
    scale,
    x: clampAxis(view.x, scale, stage.width, content.x, content.width),
    y: clampAxis(view.y, scale, stage.height, content.y, content.height)
  }
}

/** A visão de ajuste: conteúdo no menor zoom, centralizado. */
export function baseView(space: ViewSpace): PlayerView {
  return clampView({ scale: space.minScale, x: 0, y: 0 }, space)
}

/** Novo nível de zoom mantendo o ponto `anchor` (coordenadas da área) parado na tela. */
export function zoomAt(
  view: PlayerView,
  nextScale: number,
  anchor: Point,
  space: ViewSpace
): PlayerView {
  const scale = clampScale(nextScale, space)
  const ratio = scale / view.scale
  return clampView(
    {
      scale,
      x: anchor.x - (anchor.x - view.x) * ratio,
      y: anchor.y - (anchor.y - view.y) * ratio
    },
    space
  )
}

/** Zoom multiplicativo (roda, botões, teclas) em torno de `anchor`. */
export function zoomBy(
  view: PlayerView,
  factor: number,
  anchor: Point,
  space: ViewSpace
): PlayerView {
  return zoomAt(view, view.scale * factor, anchor, space)
}

export function isZoomed(view: PlayerView, space: ViewSpace): boolean {
  return view.scale > space.minScale * ZOOM_EPSILON
}

/** Duplo clique: ampliado volta ao ajuste; ajustado amplia (2x) no ponto clicado. */
export function toggleZoomAt(view: PlayerView, anchor: Point, space: ViewSpace): PlayerView {
  return isZoomed(view, space)
    ? baseView(space)
    : zoomAt(view, space.minScale * DOUBLE_CLICK_ZOOM, anchor, space)
}

export function panBy(view: PlayerView, dx: number, dy: number, space: ViewSpace): PlayerView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, space)
}

/** Fator da roda do mouse (`deltaY` em px); o gesto de pinça (Ctrl) é mais sensível. */
export function wheelFactor(deltaY: number, pinch: boolean): number {
  if (!Number.isFinite(deltaY)) return 1
  return Math.exp(-deltaY * (pinch ? 0.01 : 0.0015))
}

/** `150%`, relativo ao ajuste. */
export function formatZoom(view: PlayerView, space: ViewSpace): string {
  return `${Math.round((clampScale(view.scale, space) / space.minScale) * 100)}%`
}

/** Estilo CSS da camada do vídeo. */
export function viewTransform(view: PlayerView): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
}
