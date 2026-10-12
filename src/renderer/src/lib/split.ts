/** Fração da largura que o player ocupa por padrão (~60%). */
export const DEFAULT_SPLIT = 0.6
/** Abaixo desta largura (px) da área da Reunião, player e painel ficam um sobre o outro. */
export const STACK_BELOW_PX = 900
export const MIN_PLAYER_PX = 360
export const MIN_PANEL_PX = 320
export const DIVIDER_PX = 8
export const SPLIT_KEY_STEP = 0.02

export const SPLIT_STORAGE_KEY = 'clearmeet.meeting.split'

/** O layout empilha (player em cima, painel embaixo) quando a área é estreita. */
export function isStacked(widthPx: number): boolean {
  return widthPx < STACK_BELOW_PX
}

/**
 * Mantém a proporção do player dentro dos limites: player e painel nunca ficam menores que
 * os mínimos em pixels. `totalPx` é a largura da área (divisor incluído).
 */
export function clampSplit(ratio: number, totalPx: number): number {
  const usable = totalPx - DIVIDER_PX
  if (!(usable > MIN_PLAYER_PX + MIN_PANEL_PX)) return DEFAULT_SPLIT
  const min = MIN_PLAYER_PX / usable
  const max = 1 - MIN_PANEL_PX / usable
  const value = Number.isFinite(ratio) ? ratio : DEFAULT_SPLIT
  return Math.min(max, Math.max(min, value))
}

/** Proporção a partir da posição do ponteiro (`offsetPx` desde o início da área). */
export function splitFromPointer(offsetPx: number, totalPx: number): number {
  const usable = totalPx - DIVIDER_PX
  if (!(usable > 0)) return DEFAULT_SPLIT
  return clampSplit((offsetPx - DIVIDER_PX / 2) / usable, totalPx)
}

/** Lê o valor guardado; qualquer coisa fora de 0..1 é descartada. */
export function parseStoredSplit(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 && value < 1 ? value : null
}

export function loadSplit(): number {
  try {
    return parseStoredSplit(window.localStorage.getItem(SPLIT_STORAGE_KEY)) ?? DEFAULT_SPLIT
  } catch {
    return DEFAULT_SPLIT
  }
}

export function saveSplit(ratio: number): void {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(ratio * 1000) / 1000))
  } catch {
    // Sem armazenamento (modo restrito): a proporção só vale nesta sessão.
  }
}
