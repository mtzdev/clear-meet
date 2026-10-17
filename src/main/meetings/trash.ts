import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MEETING_FILES } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import { checkMeetingFolder } from './delete'
import { readMeeting, withFolderLock } from './repository'

/** Envia um arquivo ou pasta para a Lixeira do sistema (`shell.trashItem` no app). */
export type TrashItem = (path: string) => Promise<void>

const IN_USE = 'Não foi possível enviar para a Lixeira: algum programa está usando o arquivo.'

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

export async function fileBytes(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

/**
 * Manda só o `video.mp4` para a Lixeira. A Reunião segue válida e navegável pelo Áudio da
 * reunião, por isso só vale para Reunião pronta e que tenha `audio.opus`. Quem chama garante
 * que a Reunião não está em uso (gravação, Compactação).
 */
export function trashMeetingVideo(
  root: string,
  folder: unknown,
  trash: TrashItem
): Promise<Result<{ freedBytes: number }>> {
  if (typeof folder !== 'string') {
    return Promise.resolve(
      fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    )
  }
  return withFolderLock(folder, async () => {
    const checked = await checkMeetingFolder(root, folder)
    if (!checked.ok) return checked
    const read = await readMeeting(checked.value)
    if (!read.ok) return fail('invalid-request', read.error)
    if (read.value.status !== 'ready') {
      return fail('busy', 'A Reunião ainda não terminou de ser processada.')
    }
    const video = join(checked.value, MEETING_FILES.video)
    const freedBytes = await fileBytes(video)
    if (freedBytes === 0) return fail('not-found', 'A Reunião não tem Vídeo.')
    if ((await fileBytes(join(checked.value, MEETING_FILES.audio))) === 0) {
      return fail('invalid-request', 'A Reunião não tem áudio: ela ficaria sem nada para tocar.')
    }
    try {
      await trash(video)
    } catch {
      return fail('busy', IN_USE)
    }
    return { ok: true, value: { freedBytes } }
  })
}

/** Manda a pasta inteira da Reunião para a Lixeira. */
export function trashMeetingFolder(
  root: string,
  folder: unknown,
  trash: TrashItem
): Promise<Result<null>> {
  if (typeof folder !== 'string') {
    return Promise.resolve(
      fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    )
  }
  return withFolderLock(folder, async () => {
    const checked = await checkMeetingFolder(root, folder)
    if (!checked.ok) return checked
    try {
      await trash(checked.value)
    } catch {
      return fail('busy', IN_USE)
    }
    return { ok: true, value: null }
  })
}
