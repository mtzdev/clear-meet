import { meetingTags, type MeetingFile } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import {
  isDirectChild,
  MEETING_NOT_FOUND,
  readMeeting,
  withFolderLock,
  writeMeeting
} from './repository'

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

export const TAGS_BUSY =
  'A Reunião ainda está sendo gravada ou processada. As Tags ficam disponíveis quando ela terminar.'

/**
 * Troca as Tags da Reunião (leitura, alteração e escrita atômica na fila da pasta). Só Reuniões
 * `ready`: nas demais a gravação ou a Recuperação ainda escrevem no mesmo `meeting.json`.
 * `change` devolve a nova lista, ou `null` quando nada muda (o arquivo não é reescrito).
 */
export function editMeetingTags(
  root: string,
  folder: string,
  change: (tags: string[]) => string[] | null
): Promise<Result<string[]>> {
  if (!isDirectChild(root, folder)) {
    return Promise.resolve(
      fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    )
  }
  return withFolderLock(folder, async () => {
    const read = await readMeeting(folder)
    if (!read.ok) {
      return read.error === MEETING_NOT_FOUND
        ? fail('not-found', 'A Reunião não foi encontrada. Ela pode ter sido movida ou apagada.')
        : fail('invalid-request', read.error)
    }
    if (read.value.status !== 'ready') return fail('busy', TAGS_BUSY)
    const current = meetingTags(read.value)
    const next = change(current)
    if (next === null) return { ok: true, value: current }
    const meeting: MeetingFile = { ...read.value }
    if (next.length > 0) meeting.tags = next
    else delete meeting.tags
    try {
      await writeMeeting(folder, meeting)
    } catch {
      return fail('unknown', 'Não foi possível salvar a alteração no disco.')
    }
    return { ok: true, value: next }
  })
}
