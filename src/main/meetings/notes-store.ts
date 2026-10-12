import type { MeetingFile, MeetingNote } from '@shared/meeting'
import { insertNote, normalizeNoteText, removeNote, replaceNoteText } from '@shared/notes'
import type { RecordingError, Result } from '@shared/recording'
import {
  isDirectChild,
  MEETING_NOT_FOUND,
  newMeetingId,
  readMeeting,
  withFolderLock,
  writeMeeting
} from './repository'

/**
 * Só Reuniões `ready` são editáveis: nas demais o serviço de gravação ou a Recuperação ainda
 * escrevem no mesmo `meeting.json`.
 */

export interface NotesStoreDeps {
  now(): number
  newId(): string
}

const DEFAULT_DEPS: NotesStoreDeps = { now: () => Date.now(), newId: newMeetingId }

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

type Edit<T> = (meeting: MeetingFile) => Result<{ meeting: MeetingFile; value: T }>

async function editMeeting<T>(root: string, folder: string, edit: Edit<T>): Promise<Result<T>> {
  if (!isDirectChild(root, folder)) {
    return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
  }
  return withFolderLock(folder, async () => {
    const read = await readMeeting(folder)
    if (!read.ok) {
      return read.error === MEETING_NOT_FOUND
        ? fail('not-found', 'A Reunião não foi encontrada. Ela pode ter sido movida ou apagada.')
        : fail('invalid-request', read.error)
    }
    if (read.value.status !== 'ready') {
      return fail(
        'busy',
        'A Reunião ainda está sendo gravada ou processada. As Anotações ficam disponíveis quando ela terminar.'
      )
    }
    const edited = edit(read.value)
    if (!edited.ok) return edited
    try {
      await writeMeeting(folder, edited.value.meeting)
    } catch {
      return fail('unknown', 'Não foi possível salvar a alteração no disco.')
    }
    return { ok: true, value: edited.value.value }
  })
}

const NOTE_NOT_FOUND = 'A Anotação não existe mais.'

export function addMeetingNote(
  root: string,
  folder: string,
  input: { offsetMs: number; text: string },
  deps: NotesStoreDeps = DEFAULT_DEPS
): Promise<Result<MeetingNote>> {
  const text = normalizeNoteText(input.text)
  if (text === '') return Promise.resolve(fail('invalid-request', 'A Anotação está vazia.'))
  if (typeof input.offsetMs !== 'number' || !Number.isFinite(input.offsetMs)) {
    return Promise.resolve(fail('invalid-request', 'Instante inválido.'))
  }
  return editMeeting(root, folder, (meeting) => {
    const ceiling = meeting.durationMs ?? Number.POSITIVE_INFINITY
    const note: MeetingNote = {
      id: deps.newId(),
      offsetMs: Math.min(Math.max(0, Math.round(input.offsetMs)), ceiling),
      text,
      createdAt: new Date(deps.now()).toISOString()
    }
    return {
      ok: true,
      value: { meeting: { ...meeting, notes: insertNote(meeting.notes, note) }, value: note }
    }
  })
}

export function editMeetingNote(
  root: string,
  folder: string,
  noteId: string,
  rawText: string
): Promise<Result<MeetingNote>> {
  const text = normalizeNoteText(rawText)
  if (text === '') return Promise.resolve(fail('invalid-request', 'A Anotação está vazia.'))
  return editMeeting(root, folder, (meeting) => {
    const notes = replaceNoteText(meeting.notes, noteId, text)
    const note = notes?.find((candidate) => candidate.id === noteId)
    if (!notes || !note) return fail('not-found', NOTE_NOT_FOUND)
    return { ok: true, value: { meeting: { ...meeting, notes }, value: note } }
  })
}

export function deleteMeetingNote(
  root: string,
  folder: string,
  noteId: string
): Promise<Result<null>> {
  return editMeeting(root, folder, (meeting) => {
    const notes = removeNote(meeting.notes, noteId)
    if (!notes) return fail('not-found', NOTE_NOT_FOUND)
    return { ok: true, value: { meeting: { ...meeting, notes }, value: null } }
  })
}
