export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

export interface PlayerPrefs {
  /** Último volume audível (0 a 1). */
  volume: number
  rate: number
}

export const DEFAULT_PREFS: PlayerPrefs = { volume: 1, rate: 1 }

export const PREFS_KEY = 'clearmeet.player.prefs'
export const POSITIONS_KEY = 'clearmeet.player.positions'

/** Abaixo disto a Reunião reabre do início; perto do fim também (já foi vista). */
export const RESUME_MIN_MS = 5000
export const RESUME_END_GUARD_MS = 10000
const MAX_POSITIONS = 200

export function isPlaybackRate(value: unknown): value is (typeof PLAYBACK_RATES)[number] {
  return PLAYBACK_RATES.some((rate) => rate === value)
}

export function parsePrefs(raw: string | null): PlayerPrefs {
  if (raw === null) return DEFAULT_PREFS
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return DEFAULT_PREFS
    const { volume, rate } = data as Record<string, unknown>
    return {
      volume:
        typeof volume === 'number' && Number.isFinite(volume) && volume > 0 && volume <= 1
          ? volume
          : DEFAULT_PREFS.volume,
      rate: isPlaybackRate(rate) ? rate : DEFAULT_PREFS.rate
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function loadPrefs(): PlayerPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(prefs: PlayerPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Sem armazenamento: as preferências valem só nesta sessão.
  }
}

/** Posição guardada por Reunião (`id`), com a data para descartar as mais antigas. */
export type Positions = Record<string, { ms: number; at: number }>

export function parsePositions(raw: string | null): Positions {
  if (raw === null) return {}
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}
    const result: Positions = {}
    for (const [id, entry] of Object.entries(data)) {
      if (typeof entry !== 'object' || entry === null) continue
      const { ms, at } = entry as Record<string, unknown>
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && typeof at === 'number') {
        result[id] = { ms, at }
      }
    }
    return result
  } catch {
    return {}
  }
}

function worthResuming(ms: number, durationMs: number): boolean {
  if (!(ms >= RESUME_MIN_MS)) return false
  return !(durationMs > 0 && ms >= durationMs - RESUME_END_GUARD_MS)
}

/** Guarda a posição da Reunião; no começo ou no fim, esquece (a próxima abertura é do início). */
export function rememberPosition(
  positions: Positions,
  id: string,
  ms: number,
  durationMs: number,
  now: number
): Positions {
  const next: Positions = { ...positions }
  if (worthResuming(ms, durationMs)) next[id] = { ms: Math.round(ms), at: now }
  else delete next[id]
  const entries = Object.entries(next)
  if (entries.length <= MAX_POSITIONS) return next
  entries.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(entries.slice(0, MAX_POSITIONS))
}

/** Instante em que a Reunião deve reabrir, ou `null` para abrir do início. */
export function resumeInstant(
  positions: Positions,
  id: string,
  durationMs: number | null
): number | null {
  const entry = positions[id]
  return entry && worthResuming(entry.ms, durationMs ?? 0) ? entry.ms : null
}

export function loadPositions(): Positions {
  try {
    return parsePositions(window.localStorage.getItem(POSITIONS_KEY))
  } catch {
    return {}
  }
}

export function savePositions(positions: Positions): void {
  try {
    window.localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions))
  } catch {
    // Sem armazenamento: a posição não é lembrada.
  }
}
