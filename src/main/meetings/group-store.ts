import type { MeetingFile } from '@shared/meeting'
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

export const GROUP_BUSY =
  'A Reunião ainda está sendo gravada ou processada. O grupo pode ser trocado quando ela terminar.'

/**
 * Troca o grupo da Reunião (leitura, alteração e escrita atômica na fila da pasta). Só Reuniões
 * `ready`, como as Tags. `change` recebe o `meeting.json` e devolve o novo `groupId` (`null` tira
 * do grupo), ou `undefined` quando nada muda (o arquivo não é reescrito).
 */
export function editMeetingGroup(
  root: string,
  folder: string,
  change: (meeting: MeetingFile) => string | null | undefined
): Promise<Result<string | null>> {
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
    if (read.value.status !== 'ready') return fail('busy', GROUP_BUSY)
    const current = read.value.groupId ?? null
    const next = change(read.value)
    if (next === undefined || next === current) return { ok: true, value: current }
    const meeting: MeetingFile = { ...read.value }
    if (next === null) delete meeting.groupId
    else meeting.groupId = next
    try {
      await writeMeeting(folder, meeting)
    } catch {
      return fail('unknown', 'Não foi possível salvar a alteração no disco.')
    }
    return { ok: true, value: next }
  })
}
