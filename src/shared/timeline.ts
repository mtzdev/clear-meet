import type { MeetingNote } from './meeting'

/** O Instante zero é o início do Áudio da reunião; o Vídeo usa a mesma linha do tempo. */

/** Salto das teclas ← e → (ms). */
export const SEEK_STEP_MS = 5000

/**
 * `mm:ss` (ou `h:mm:ss` a partir de 1 hora). Arredonda para baixo, como relógio de player;
 * valor inválido ou negativo vira `00:00`.
 */
export function formatInstant(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** Limita `ms` ao intervalo `[0, durationMs]` (duração desconhecida: só não deixa ser negativo). */
export function clampInstant(ms: number, durationMs: number): number {
  if (!Number.isFinite(ms)) return 0
  const floor = Math.max(0, ms)
  return durationMs > 0 ? Math.min(floor, durationMs) : floor
}

/** Posição (0 a 1) de um Instante na linha do tempo; sem duração conhecida, 0. */
export function markerPosition(offsetMs: number, durationMs: number): number {
  if (!(durationMs > 0) || !Number.isFinite(offsetMs)) return 0
  return Math.min(1, Math.max(0, offsetMs / durationMs))
}

/** Instante correspondente a uma posição (0 a 1) na linha do tempo. */
export function instantAtPosition(fraction: number, durationMs: number): number {
  if (!(durationMs > 0) || !Number.isFinite(fraction)) return 0
  return Math.round(Math.min(1, Math.max(0, fraction)) * durationMs)
}

/** Posição atual após um salto relativo (←/→), sempre dentro da Reunião. */
export function seekBy(currentMs: number, deltaMs: number, durationMs: number): number {
  return clampInstant(currentMs + deltaMs, durationMs)
}

/**
 * Duração a usar na linha do tempo: a do arquivo de mídia quando o player já a conhece
 * (finita e positiva); senão a gravada no `meeting.json`; senão 0.
 */
export function timelineDurationMs(
  mediaDurationSec: number,
  meetingDurationMs: number | null
): number {
  if (Number.isFinite(mediaDurationSec) && mediaDurationSec > 0) {
    return Math.round(mediaDurationSec * 1000)
  }
  return meetingDurationMs !== null && meetingDurationMs > 0 ? meetingDurationMs : 0
}

/**
 * Anotação "atual": a última cujo Instante já passou (as Anotações vêm ordenadas por
 * Instante). `null` antes da primeira.
 */
export function currentNoteId(notes: readonly MeetingNote[], currentMs: number): string | null {
  let current: string | null = null
  for (const note of notes) {
    if (note.offsetMs > currentMs) break
    current = note.id
  }
  return current
}
