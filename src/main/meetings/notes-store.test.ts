import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MEETING_FILE,
  MEETING_SCHEMA_VERSION,
  type MeetingFile,
  type MeetingNote
} from '@shared/meeting'
import { MAX_NOTE_LENGTH } from '@shared/notes'
import { addMeetingNote, deleteMeetingNote, editMeetingNote } from './notes-store'
import { readMeeting, writeMeeting } from './repository'

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

let root: string
let folder: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-notes-'))
  folder = join(root, 'reuniao')
  await mkdir(folder)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function saved(): Promise<MeetingFile> {
  const read = await readMeeting(folder)
  if (!read.ok) throw new Error(read.error)
  return read.value
}

let counter = 0
const deps = {
  now: () => Date.parse('2026-10-11T12:00:00.000Z'),
  newId: () => `nota-${++counter}`
}

const SUMMARY: MeetingFile['summary'] = {
  status: 'ready',
  provider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  updatedAt: '2026-10-11T11:00:00.000Z'
}

describe('addMeetingNote', () => {
  it('grava a Anotação no meeting.json, mantendo a ordem por Instante e o resto do arquivo', async () => {
    const existing: MeetingNote = {
      id: 'velha',
      offsetMs: 30_000,
      text: 'antiga',
      createdAt: '2026-10-10T17:40:00.000Z'
    }
    await writeMeeting(folder, meeting({ notes: [existing], summary: SUMMARY }))

    const result = await addMeetingNote(root, folder, { offsetMs: 10_000, text: '  nova  ' }, deps)
    expect(result.ok && result.value).toEqual({
      id: expect.stringMatching(/^nota-/) as string,
      offsetMs: 10_000,
      text: 'nova',
      createdAt: '2026-10-11T12:00:00.000Z'
    })
    const file = await saved()
    expect(file.notes.map((entry) => entry.text)).toEqual(['nova', 'antiga'])
    expect(file.summary).toEqual(SUMMARY)
    // Escrita atômica: nada além do meeting.json fica na pasta.
    expect(await readdir(folder)).toEqual([MEETING_FILE])
  })

  it('arredonda o Instante e limita ao intervalo da Reunião', async () => {
    await writeMeeting(folder, meeting())
    const late = await addMeetingNote(root, folder, { offsetMs: 999_999, text: 'fim' }, deps)
    const early = await addMeetingNote(root, folder, { offsetMs: -50, text: 'início' }, deps)
    const round = await addMeetingNote(root, folder, { offsetMs: 1234.6, text: 'meio' }, deps)
    expect(late.ok && late.value.offsetMs).toBe(60_000)
    expect(early.ok && early.value.offsetMs).toBe(0)
    expect(round.ok && round.value.offsetMs).toBe(1235)
  })

  it('recusa texto vazio, Instante inválido e texto enorme é cortado', async () => {
    await writeMeeting(folder, meeting())
    const empty = await addMeetingNote(root, folder, { offsetMs: 0, text: '   ' }, deps)
    expect(!empty.ok && empty.error.code).toBe('invalid-request')
    const bad = await addMeetingNote(root, folder, { offsetMs: Number.NaN, text: 'x' }, deps)
    expect(!bad.ok && bad.error.code).toBe('invalid-request')
    const huge = await addMeetingNote(root, folder, { offsetMs: 0, text: 'a'.repeat(99_999) }, deps)
    expect(huge.ok && huge.value.text).toHaveLength(MAX_NOTE_LENGTH)
    expect((await saved()).notes).toHaveLength(1)
  })

  it('não edita Reunião em gravação ou ainda não finalizada', async () => {
    for (const status of ['recording', 'processing', 'unprocessed'] as const) {
      await writeMeeting(folder, meeting({ status }))
      const result = await addMeetingNote(root, folder, { offsetMs: 0, text: 'x' }, deps)
      expect(!result.ok && result.error.code, status).toBe('busy')
      expect((await saved()).notes).toEqual([])
    }
  })

  it('recusa pasta fora da pasta das Reuniões e pasta sem meeting.json', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'clearmeet-fora-'))
    try {
      await writeMeeting(outside, meeting())
      const out = await addMeetingNote(root, outside, { offsetMs: 0, text: 'x' }, deps)
      expect(!out.ok && out.error.code).toBe('invalid-request')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
    const missing = await addMeetingNote(root, folder, { offsetMs: 0, text: 'x' }, deps)
    expect(!missing.ok && missing.error.code).toBe('not-found')
  })

  it('várias adições simultâneas não perdem nenhuma', async () => {
    await writeMeeting(folder, meeting())
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        addMeetingNote(root, folder, { offsetMs: index * 1000, text: `n${index}` }, deps)
      )
    )
    expect(results.every((result) => result.ok)).toBe(true)
    const file = await saved()
    expect(file.notes.map((entry) => entry.text)).toEqual(
      Array.from({ length: 12 }, (_, index) => `n${index}`)
    )
  })
})

describe('editMeetingNote / deleteMeetingNote', () => {
  const first: MeetingNote = {
    id: 'a',
    offsetMs: 1000,
    text: 'um',
    createdAt: '2026-10-10T17:40:00.000Z'
  }
  const second: MeetingNote = { ...first, id: 'b', offsetMs: 2000, text: 'dois' }

  beforeEach(async () => {
    await writeMeeting(folder, meeting({ notes: [first, second] }))
  })

  it('edita só o texto, mantendo Instante e criação', async () => {
    const result = await editMeetingNote(root, folder, 'b', '  dois corrigido ')
    expect(result.ok && result.value).toEqual({ ...second, text: 'dois corrigido' })
    expect((await saved()).notes).toEqual([first, { ...second, text: 'dois corrigido' }])
  })

  it('recusa texto vazio e Anotação inexistente sem mexer no arquivo', async () => {
    const empty = await editMeetingNote(root, folder, 'a', '  ')
    expect(!empty.ok && empty.error.code).toBe('invalid-request')
    const missing = await editMeetingNote(root, folder, 'zzz', 'x')
    expect(!missing.ok && missing.error.code).toBe('not-found')
    expect((await saved()).notes).toEqual([first, second])
  })

  it('exclui a Anotação pedida', async () => {
    expect(await deleteMeetingNote(root, folder, 'a')).toEqual({ ok: true, value: null })
    expect((await saved()).notes).toEqual([second])
    const again = await deleteMeetingNote(root, folder, 'a')
    expect(!again.ok && again.error.code).toBe('not-found')
  })

  it('edição e exclusão também respeitam o bloqueio de Reunião não finalizada', async () => {
    await writeMeeting(folder, meeting({ status: 'recording', notes: [first] }))
    const edit = await editMeetingNote(root, folder, 'a', 'novo')
    const del = await deleteMeetingNote(root, folder, 'a')
    expect(!edit.ok && edit.error.code).toBe('busy')
    expect(!del.ok && del.error.code).toBe('busy')
    expect((await saved()).notes).toEqual([first])
  })
})
