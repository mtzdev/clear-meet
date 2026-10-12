import { clockElapsedMs, type ClockSnapshot } from './clock'
import type { MeetingNote } from './meeting'

/**
 * Anotações ao vivo (Fase 3). Lógica pura: o main escolhe o Instante e valida o texto; a
 * UI da barra e do campo de Anotação só exibem.
 */

/** Atalho global padrão para abrir o campo de Anotação (formato de acelerador do Electron). */
export const DEFAULT_NOTE_SHORTCUT = 'Ctrl+Shift+Space'
/** Recuo padrão do Instante: anotar leva alguns segundos, o assunto foi dito antes. */
export const DEFAULT_NOTE_LEAD_SECONDS = 5
export const MAX_NOTE_LEAD_SECONDS = 300
/** Limite do texto de uma Anotação (protege o `meeting.json` de colagens enormes). */
export const MAX_NOTE_LENGTH = 5000

/**
 * Instante (ms) de uma Anotação: o Instante da gravação no momento `at` (primeira tecla
 * digitada) menos o recuo. Nunca negativo. Como o relógio não conta as pausas, durante uma
 * pausa o Instante fica parado.
 */
export function noteOffsetMs(clock: ClockSnapshot, at: number, leadSeconds: number): number {
  const lead = Number.isFinite(leadSeconds) ? Math.max(0, leadSeconds) * 1000 : 0
  return Math.max(0, Math.round(clockElapsedMs(clock, at) - lead))
}

/** Texto de uma Anotação pronto para salvar: quebras `\n`, sem espaços nas pontas, limitado. */
export function normalizeNoteText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTE_LENGTH).trimEnd()
}

/** Insere a Anotação mantendo a lista ordenada por Instante (estável: empates ficam em ordem de criação). */
export function insertNote(notes: readonly MeetingNote[], note: MeetingNote): MeetingNote[] {
  const index = notes.findIndex((existing) => existing.offsetMs > note.offsetMs)
  if (index === -1) return [...notes, note]
  return [...notes.slice(0, index), note, ...notes.slice(index)]
}

/** Troca o texto de uma Anotação (o Instante e o resto ficam). `null` se ela não existe. */
export function replaceNoteText(
  notes: readonly MeetingNote[],
  id: string,
  text: string
): MeetingNote[] | null {
  if (!notes.some((note) => note.id === id)) return null
  return notes.map((note) => (note.id === id ? { ...note, text } : note))
}

/** Remove uma Anotação. `null` se ela não existe. */
export function removeNote(notes: readonly MeetingNote[], id: string): MeetingNote[] | null {
  if (!notes.some((note) => note.id === id)) return null
  return notes.filter((note) => note.id !== id)
}
