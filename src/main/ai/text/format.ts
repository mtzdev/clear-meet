import type { MeetingNote } from '@shared/meeting'
import { formatInstant } from '@shared/timeline'
import { labelFor, type TranscriptFile, type Utterance } from '@shared/transcript'

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Uma Fala como `[mm:ss] Nome: texto`, com o nome atual do Falante. */
export function utteranceLine(transcript: TranscriptFile, utterance: Utterance): string {
  return `[${formatInstant(utterance.startMs)}] ${labelFor(transcript.speakers, utterance.speakerId)}: ${oneLine(utterance.text)}`
}

/** Anotações do usuário que têm texto, em ordem de Instante, uma por linha. */
export function noteLines(notes: readonly MeetingNote[]): string[] {
  return notes
    .filter((note) => oneLine(note.text) !== '')
    .sort((a, b) => a.offsetMs - b.offsetMs)
    .map((note) => `[${formatInstant(note.offsetMs)}] ${oneLine(note.text)}`)
}

export const NOTES_HEADING =
  '=== ANOTAÇÕES DO USUÁRIO (escritas por ele; não foram ditas na Reunião) ==='

/**
 * A Reunião como texto para a IA: uma linha por Fala (`[mm:ss] Nome: texto`) com os nomes
 * atuais dos Falantes, seguida das Anotações do usuário, marcadas como contexto à parte
 * (não foram ditas).
 */
export function formatMeetingForAi(
  meeting: { name: string; durationMs: number | null },
  transcript: TranscriptFile,
  notes: readonly MeetingNote[]
): string {
  const duration = meeting.durationMs ?? transcript.durationMs
  const header = `Reunião: ${oneLine(meeting.name)}${
    duration ? ` (duração ${formatInstant(duration)})` : ''
  }`
  const lines = transcript.utterances.map((utterance) => utteranceLine(transcript, utterance))
  const parts = [header, '', '=== TRANSCRIÇÃO ===', ...lines]

  const written = noteLines(notes)
  if (written.length > 0) parts.push('', NOTES_HEADING, ...written)
  return parts.join('\n')
}
