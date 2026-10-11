/**
 * Barra flutuante e campo de Anotação (Fase 3): tipos trocados com a UI e a geometria das
 * janelas (posição padrão, posição lembrada que ainda precisa caber num monitor, posição do
 * campo de Anotação). Tudo puro, em pixels independentes de densidade (DIP).
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

/** Tamanho da barra: a altura cresce quando há uma linha de aviso/feedback (a UI informa). */
export const BAR_SIZE: Size = { width: 372, height: 52 }
export const BAR_MAX_HEIGHT = 140
/** Distância do topo da área útil à barra, na posição padrão. */
export const BAR_TOP_MARGIN = 10
export const NOTE_WINDOW_SIZE: Size = { width: 460, height: 172 }
/** Espaço entre a barra e o campo de Anotação. */
export const NOTE_GAP = 8

/** O que a barra precisa saber além do estado da gravação. */
export interface FloatingInfo {
  /** Atalho global das Anotações (formato do Electron), para exibir. */
  shortcut: string
  /** `false` se o Windows recusou o registro (atalho em uso por outro app). */
  shortcutRegistered: boolean
}

/** Evento: uma Anotação foi salva (a barra mostra um aviso breve). */
export interface NoteSavedEvent {
  offsetMs: number
}

/** Altura pedida pela UI da barra, limitada ao intervalo aceito. */
export function clampBarHeight(height: unknown): number {
  if (typeof height !== 'number' || !Number.isFinite(height)) return BAR_SIZE.height
  return Math.round(Math.min(BAR_MAX_HEIGHT, Math.max(BAR_SIZE.height, height)))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function contains(area: Rect, point: Point): boolean {
  return (
    point.x >= area.x &&
    point.x < area.x + area.width &&
    point.y >= area.y &&
    point.y < area.y + area.height
  )
}

/** Mantém um retângulo de `size` dentro de `area` (a área vence se o retângulo for maior). */
export function clampIntoArea(position: Point, size: Size, area: Rect): Point {
  return {
    x: Math.round(clamp(position.x, area.x, area.x + area.width - size.width)),
    y: Math.round(clamp(position.y, area.y, area.y + area.height - size.height))
  }
}

/** Posição padrão da barra: topo, centralizada na área útil do monitor principal. */
export function defaultBarPosition(primary: Rect, size: Size = BAR_SIZE): Point {
  return {
    x: Math.round(primary.x + (primary.width - size.width) / 2),
    y: primary.y + BAR_TOP_MARGIN
  }
}

/**
 * Posição da barra ao iniciar a gravação. A última posição lembrada só vale se o centro da
 * barra ainda cair em algum monitor (monitor desconectado, resolução trocada); nesse caso é
 * ajustada para caber inteira nele. Senão, volta ao topo-centro do monitor principal.
 */
export function resolveBarPosition(
  saved: Point | null,
  workAreas: readonly Rect[],
  primary: Rect,
  size: Size = BAR_SIZE
): Point {
  if (saved) {
    const area = workAreas.find((candidate) => contains(candidate, center({ ...saved, ...size })))
    if (area) return clampIntoArea(saved, size, area)
  }
  return defaultBarPosition(primary, size)
}

/** Monitor (área útil) onde está o centro de `rect`; na falta, o principal. */
export function pickWorkArea(rect: Rect, workAreas: readonly Rect[], primary: Rect): Rect {
  return workAreas.find((area) => contains(area, center(rect))) ?? primary
}

/**
 * Onde abrir o campo de Anotação: logo abaixo da barra, centralizado nela; se não houver
 * espaço embaixo (barra arrastada para o rodapé), logo acima. Sempre dentro da área útil.
 */
export function placeNoteWindow(bar: Rect, size: Size, area: Rect): Point {
  const below = bar.y + bar.height + NOTE_GAP
  const fitsBelow = below + size.height <= area.y + area.height
  const y = fitsBelow ? below : bar.y - NOTE_GAP - size.height
  const x = bar.x + (bar.width - size.width) / 2
  return clampIntoArea({ x, y }, size, area)
}
