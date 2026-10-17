import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MEETING_SCHEMA_VERSION, type MeetingFile, type MeetingNote } from '@shared/meeting'
import { SUMMARY_SCHEMA_VERSION, type SummaryFile } from '@shared/summary'
import { TRANSCRIPT_SCHEMA_VERSION, type TranscriptFile } from '@shared/transcript'
import { writeMeeting } from '../meetings/repository'
import { writeSummary } from '../meetings/summary-store'
import { writeTranscript } from '../meetings/transcript-store'

export function makeMeeting(overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: 'id-1',
    name: 'Reunião',
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: '2026-10-10T18:00:00.000Z',
    durationMs: 1_800_000,
    status: 'ready',
    source: { kind: 'window', name: 'Zoom' },
    quality: '1080p',
    video: { file: 'video.mp4', width: 1920, height: 1080, fps: 15 },
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: [],
    ...overrides
  }
}

export function makeNote(id: string, offsetMs: number, text: string): MeetingNote {
  return { id, offsetMs, text, createdAt: '2026-10-10T18:00:00.000Z' }
}

export function makeTranscript(
  utterances: { speaker: string; startMs: number; text: string }[]
): TranscriptFile {
  const names = [...new Set(utterances.map((item) => item.speaker))]
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    model: 'gemini-teste',
    createdAt: '2026-10-10T18:05:00.000Z',
    durationMs: 1_800_000,
    speakers: names.map((name, index) => ({ id: `s${index + 1}`, name })),
    utterances: utterances.map((item, index) => ({
      id: `u${index}`,
      speakerId: `s${names.indexOf(item.speaker) + 1}`,
      startMs: item.startMs,
      text: item.text
    }))
  }
}

export function makeSummary(overrides: Partial<SummaryFile> = {}): SummaryFile {
  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    provider: 'groq',
    model: 'modelo-teste',
    createdAt: '2026-10-10T18:10:00.000Z',
    overview: 'Visão geral da conversa.',
    keyPoints: [],
    decisions: [],
    actions: [],
    ...overrides
  }
}

export interface FolderSpec {
  meeting?: Partial<MeetingFile>
  transcript?: TranscriptFile
  summary?: SummaryFile
  /** Arquivos extras com conteúdo de mentira (`video.mp4`, `audio.opus`...). */
  files?: Record<string, string>
}

/** Cria a pasta de uma Reunião dentro de `root` e devolve o caminho. */
export async function createFolder(
  root: string,
  name: string,
  spec: FolderSpec = {}
): Promise<string> {
  const folder = join(root, name)
  await mkdir(folder, { recursive: true })
  await writeMeeting(folder, makeMeeting(spec.meeting))
  if (spec.transcript) await writeTranscript(folder, spec.transcript)
  if (spec.summary) await writeSummary(folder, spec.summary)
  for (const [file, content] of Object.entries(spec.files ?? {})) {
    await writeFile(join(folder, file), content)
  }
  return folder
}
