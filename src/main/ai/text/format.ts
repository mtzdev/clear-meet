import type { MeetingNote } from '@shared/meeting'
import { formatInstant } from '@shared/timeline'
import { labelFor, type TranscriptFile } from '@shared/transcript'

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

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
  const lines = transcript.utterances.map(
    (utterance) =>
      `[${formatInstant(utterance.startMs)}] ${labelFor(transcript.speakers, utterance.speakerId)}: ${oneLine(utterance.text)}`
  )
  const parts = [header, '', '=== TRANSCRIÇÃO ===', ...lines]

  const written = notes
    .filter((note) => oneLine(note.text) !== '')
    .sort((a, b) => a.offsetMs - b.offsetMs)
  if (written.length > 0) {
    parts.push(
      '',
      '=== ANOTAÇÕES DO USUÁRIO (escritas por ele; não foram ditas na Reunião) ===',
      ...written.map((note) => `[${formatInstant(note.offsetMs)}] ${oneLine(note.text)}`)
    )
  }
  return parts.join('\n')
}
