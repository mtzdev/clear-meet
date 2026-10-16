import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MEETING_SCHEMA_VERSION, serializeMeeting, type MeetingFile } from '@shared/meeting'
import {
  serializeTranscript,
  TRANSCRIPT_FILE,
  TRANSCRIPT_SCHEMA_VERSION,
  type TranscriptFile
} from '@shared/transcript'

/** Apoio dos testes dos serviços de IA: uma pasta de Reuniões temporária com uma Reunião pronta. */
export function meetingFile(overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: 'meeting-1234567890',
    name: 'Planejamento',
    createdAt: '2026-10-13T12:00:00.000Z',
    endedAt: '2026-10-13T12:10:00.000Z',
    durationMs: 600_000,
    status: 'ready',
    source: { kind: 'none', name: null },
    quality: '1080p',
    video: null,
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: [],
    transcript: { status: 'ready', model: 'm', updatedAt: '2026-10-13T12:20:00.000Z' },
    ...overrides
  }
}

export function transcriptFile(overrides: Partial<TranscriptFile> = {}): TranscriptFile {
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    model: 'm',
    createdAt: '2026-10-13T12:20:00.000Z',
    durationMs: 600_000,
    speakers: [
      { id: 's1', name: 'Ana' },
      { id: 's2', name: null }
    ],
    utterances: [
      { id: 'u1', speakerId: 's1', startMs: 5000, text: 'Vamos adiar o lançamento.' },
      { id: 'u2', speakerId: 's2', startMs: 65_000, text: 'Concordo, fica para novembro.' }
    ],
    ...overrides
  }
}

export interface TempMeetings {
  root: string
  folder: string
  cleanup(): Promise<void>
}

export async function tempMeetings(
  meeting: MeetingFile | null = meetingFile(),
  transcript: TranscriptFile | null = transcriptFile()
): Promise<TempMeetings> {
  const root = await mkdtemp(join(tmpdir(), 'clearmeet-texto-'))
  const folder = join(root, 'reuniao')
  await mkdir(folder)
  if (meeting) await writeFile(join(folder, 'meeting.json'), serializeMeeting(meeting))
  if (transcript) await writeFile(join(folder, TRANSCRIPT_FILE), serializeTranscript(transcript))
  return { root, folder, cleanup: () => rm(root, { recursive: true, force: true }) }
}
