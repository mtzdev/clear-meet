import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEETING_SCHEMA_VERSION, serializeMeeting, type MeetingFile } from '@shared/meeting'
import {
  TRANSCRIPT_FILE,
  TRANSCRIPT_PARTIAL_FILE,
  TRANSCRIPT_SCHEMA_VERSION,
  type TranscriptFile
} from '@shared/transcript'
import { addMeetingNote } from './notes-store'
import { readMeeting } from './repository'
import {
  readPartial,
  readTranscript,
  removePartial,
  renameTranscriptSpeaker,
  updateTranscriptMeta,
  writePartial,
  writeTranscript
} from './transcript-store'

function meeting(overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: 'id-1',
    name: 'Reunião',
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: '2026-10-10T18:00:00.000Z',
    durationMs: 60_000,
    status: 'ready',
    source: { kind: 'none', name: null },
    quality: '1080p',
    video: null,
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: [],
    ...overrides
  }
}

const transcript: TranscriptFile = {
  schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
  model: 'gemini-3.5-flash-lite',
  createdAt: '2026-10-12T10:00:00.000Z',
  durationMs: 60_000,
  speakers: [
    { id: 's1', name: 'Ana' },
    { id: 's2', name: null }
  ],
  utterances: [
    { id: 'u1', speakerId: 's1', startMs: 1000, text: 'Bom dia' },
    { id: 'u2', speakerId: 's2', startMs: 2000, text: 'Bom dia, Ana' }
  ]
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-transcript-store-'))
  await writeFile(join(root, 'meeting.json'), serializeMeeting(meeting()))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('transcript.json', () => {
  it('sem arquivo devolve null; depois de gravar, lê de volta', async () => {
    expect(await readTranscript(root)).toEqual({ ok: true, value: null })
    await writeTranscript(root, transcript)
    expect(await readTranscript(root)).toEqual({ ok: true, value: transcript })
  })

  it('arquivo corrompido vira erro explicado, sem lançar', async () => {
    await writeFile(join(root, TRANSCRIPT_FILE), '{ não é json')
    const result = await readTranscript(root)
    expect(result.ok).toBe(false)
  })
})

describe('renameTranscriptSpeaker', () => {
  it('grava o novo nome em transcript.json e devolve a Transcrição inteira', async () => {
    await writeTranscript(root, transcript)
    const result = await renameTranscriptSpeaker(root, 's2', 'Bruno')
    expect(result.ok && result.value.speakers).toEqual([
      { id: 's1', name: 'Ana' },
      { id: 's2', name: 'Bruno' }
    ])
    const reread = await readTranscript(root)
    expect(reread.ok && reread.value?.speakers[1]?.name).toBe('Bruno')
    expect(reread.ok && reread.value?.utterances).toEqual(transcript.utterances)
  })

  it('recusa nome repetido, Falante inexistente e Reunião sem Transcrição', async () => {
    expect(await renameTranscriptSpeaker(root, 's2', 'Bruno')).toMatchObject({
      ok: false,
      error: { code: 'not-found' }
    })
    await writeTranscript(root, transcript)
    expect(await renameTranscriptSpeaker(root, 's2', 'ana')).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
    expect(await renameTranscriptSpeaker(root, 'zzz', 'Bruno')).toMatchObject({ ok: false })
  })

  it('uma Transcrição da versão 1 é lida e já volta gravada na versão atual', async () => {
    await writeFile(
      join(root, TRANSCRIPT_FILE),
      JSON.stringify({
        schemaVersion: 1,
        model: 'm',
        createdAt: '2026-10-12T10:00:00.000Z',
        durationMs: 1000,
        speakers: ['Falante 1', '11:20'],
        utterances: [
          { id: 'u1', speaker: 'Falante 1', startMs: 0, text: 'a' },
          { id: 'u2', speaker: '11:20', startMs: 500, text: 'b' }
        ]
      })
    )
    const result = await renameTranscriptSpeaker(root, 's2', '')
    expect(result.ok && result.value.schemaVersion).toBe(TRANSCRIPT_SCHEMA_VERSION)
    expect(result.ok && result.value.speakers).toEqual([
      { id: 's1', name: null },
      { id: 's2', name: null }
    ])
  })
})

describe('transcript.partial.json', () => {
  const partial = {
    schemaVersion: 1 as const,
    model: 'm',
    durationMs: 1000,
    chunks: [
      {
        index: 0,
        startMs: 0,
        endMs: 500,
        utterances: [{ speaker: 'Ana', startMs: 10, text: 'oi' }]
      }
    ]
  }

  it('grava, lê e remove', async () => {
    await writePartial(root, partial)
    expect(await readPartial(root)).toEqual(partial)
    await removePartial(root)
    expect(await readPartial(root)).toBeNull()
  })

  it('conteúdo inválido é ignorado (recomeça do zero)', async () => {
    await writeFile(
      join(root, TRANSCRIPT_PARTIAL_FILE),
      JSON.stringify({ ...partial, chunks: [{}] })
    )
    expect(await readPartial(root)).toBeNull()
    await writeFile(join(root, TRANSCRIPT_PARTIAL_FILE), 'lixo')
    expect(await readPartial(root)).toBeNull()
  })
})

describe('updateTranscriptMeta', () => {
  const running = {
    status: 'running' as const,
    model: 'gemini-3.5-flash-lite',
    updatedAt: '2026-10-12T10:00:00.000Z'
  }

  it('grava o estado no meeting.json sem tocar no resto', async () => {
    const saved = await updateTranscriptMeta(root, () => running)
    expect(saved?.transcript).toEqual(running)
    const read = await readMeeting(root)
    expect(read.ok && read.value.transcript).toEqual(running)
    expect(read.ok && read.value.name).toBe('Reunião')
  })

  it('recebe o estado anterior e pode removê-lo', async () => {
    await updateTranscriptMeta(root, () => running)
    await updateTranscriptMeta(root, (previous) =>
      previous ? { ...previous, status: 'error', error: 'falhou' } : undefined
    )
    let read = await readMeeting(root)
    expect(read.ok && read.value.transcript).toMatchObject({ status: 'error', error: 'falhou' })

    await updateTranscriptMeta(root, () => undefined)
    read = await readMeeting(root)
    expect(read.ok && read.value.transcript).toBeUndefined()
  })

  it('não atropela Anotações salvas ao mesmo tempo', async () => {
    const outcomes = await Promise.all([
      updateTranscriptMeta(root, () => running),
      addMeetingNote(join(root, '..'), root, { offsetMs: 1000, text: 'nota' })
    ])
    expect(outcomes[0]).not.toBeNull()
    const read = await readMeeting(root)
    expect(read.ok && read.value.notes).toHaveLength(1)
    expect(read.ok && read.value.transcript).toEqual(running)
  })

  it('pasta sem meeting.json devolve null', async () => {
    await rm(join(root, 'meeting.json'))
    expect(await updateTranscriptMeta(root, () => running)).toBeNull()
  })
})
