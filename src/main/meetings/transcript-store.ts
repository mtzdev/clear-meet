import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { MeetingFile } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import {
  parseTranscriptText,
  renameSpeaker,
  serializeTranscript,
  TRANSCRIPT_FILE,
  TRANSCRIPT_PARTIAL_FILE,
  type TranscriptFile,
  type TranscriptMeta
} from '@shared/transcript'
import { writeFileAtomic } from '../fs/atomic'
import { readMeeting, withFolderLock, writeMeeting } from './repository'

/** Fala de um bloco como o Gemini devolveu (Instante relativo ao bloco). */
export interface PartialUtterance {
  speaker: string
  startMs: number
  text: string
}

export interface PartialChunk {
  index: number
  startMs: number
  endMs: number
  utterances: PartialUtterance[]
}

/** Blocos já transcritos de uma Transcrição que ainda não terminou. */
export interface PartialTranscript {
  schemaVersion: 1
  model: string
  durationMs: number
  chunks: PartialChunk[]
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

export async function readTranscript(folder: string): Promise<Result<TranscriptFile | null>> {
  let text: string
  try {
    text = await readFile(join(folder, TRANSCRIPT_FILE), 'utf8')
  } catch {
    return { ok: true, value: null }
  }
  const parsed = parseTranscriptText(text)
  return parsed.ok
    ? { ok: true, value: parsed.value }
    : fail('invalid-request', `Não foi possível ler a Transcrição: ${parsed.error}.`)
}

export function writeTranscript(folder: string, transcript: TranscriptFile): Promise<void> {
  return writeFileAtomic(join(folder, TRANSCRIPT_FILE), serializeTranscript(transcript))
}

function isPartialChunk(value: unknown): value is PartialChunk {
  if (typeof value !== 'object' || value === null) return false
  const chunk = value as Record<string, unknown>
  return (
    typeof chunk.index === 'number' &&
    typeof chunk.startMs === 'number' &&
    typeof chunk.endMs === 'number' &&
    Array.isArray(chunk.utterances) &&
    chunk.utterances.every(
      (u) =>
        typeof u === 'object' &&
        u !== null &&
        typeof (u as PartialUtterance).speaker === 'string' &&
        typeof (u as PartialUtterance).text === 'string' &&
        Number.isFinite((u as PartialUtterance).startMs)
    )
  )
}

/** Blocos salvos de uma tentativa anterior; ausente ou ilegível = `null` (começa do zero). */
export async function readPartial(folder: string): Promise<PartialTranscript | null> {
  try {
    const raw = JSON.parse(await readFile(join(folder, TRANSCRIPT_PARTIAL_FILE), 'utf8')) as Record<
      string,
      unknown
    >
    if (
      raw.schemaVersion !== 1 ||
      typeof raw.model !== 'string' ||
      typeof raw.durationMs !== 'number' ||
      !Array.isArray(raw.chunks) ||
      !raw.chunks.every(isPartialChunk)
    ) {
      return null
    }
    return {
      schemaVersion: 1,
      model: raw.model,
      durationMs: raw.durationMs,
      chunks: raw.chunks
    }
  } catch {
    return null
  }
}

export function writePartial(folder: string, partial: PartialTranscript): Promise<void> {
  return writeFileAtomic(
    join(folder, TRANSCRIPT_PARTIAL_FILE),
    `${JSON.stringify(partial, null, 2)}\n`
  )
}

export function removePartial(folder: string): Promise<void> {
  return rm(join(folder, TRANSCRIPT_PARTIAL_FILE), { force: true })
}

/**
 * Atualiza o estado da Transcrição no `meeting.json` (leitura-modificação-escrita sob a trava
 * da pasta, sem atropelar Anotações ou renomeação). `update` devolve o novo estado, ou
 * `undefined` para tirar o bloco. Devolve a Reunião gravada, ou `null` se não deu para ler.
 */
export function updateTranscriptMeta(
  folder: string,
  update: (previous: TranscriptMeta | undefined) => TranscriptMeta | undefined
): Promise<MeetingFile | null> {
  return withFolderLock(folder, async () => {
    const read = await readMeeting(folder)
    if (!read.ok) return null
    const { transcript: previous, ...rest } = read.value
    const next = update(previous)
    const meeting: MeetingFile = next ? { ...rest, transcript: next } : rest
    await writeMeeting(folder, meeting)
    return meeting
  })
}

/** Renomeia um Falante no `transcript.json`, sob a trava da pasta (nunca em cima de uma escrita em curso). */
export function renameTranscriptSpeaker(
  folder: string,
  speakerId: string,
  name: string
): Promise<Result<TranscriptFile>> {
  return withFolderLock(folder, async () => {
    const current = await readTranscript(folder)
    if (!current.ok) return current
    if (!current.value) return fail('not-found', 'A Reunião não tem Transcrição.')
    const renamed = renameSpeaker(current.value.speakers, speakerId, name)
    if (!renamed.ok) return fail('invalid-request', renamed.error)
    const next: TranscriptFile = { ...current.value, speakers: renamed.speakers }
    try {
      await writeTranscript(folder, next)
    } catch {
      return fail('unknown', 'Não foi possível salvar a alteração no disco.')
    }
    return { ok: true, value: next }
  })
}
