import { lstat, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { MEETING_FILE } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import { isDirectChild, isStagingName } from './repository'

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Confere que `folder` (vinda da UI) é mesmo a pasta de uma Reunião diretamente dentro de
 * `root`: nada de `..`, de outra pasta, de atalho (link simbólico) ou de pasta sem `meeting.json`.
 * Devolve o caminho normalizado.
 */
export async function checkMeetingFolder(root: string, folder: unknown): Promise<Result<string>> {
  if (typeof folder !== 'string' || folder === '' || !isDirectChild(root, folder)) {
    return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
  }
  const resolved = resolve(folder)
  if (isStagingName(basename(resolved))) {
    return fail('invalid-request', 'A pasta não é de uma Reunião.')
  }
  let info
  try {
    info = await lstat(resolved)
  } catch {
    return fail('not-found', 'A Reunião não foi encontrada. Ela pode ter sido movida ou apagada.')
  }
  if (!info.isDirectory() || !(await isFile(join(resolved, MEETING_FILE)))) {
    return fail('invalid-request', 'A pasta não é de uma Reunião.')
  }
  return { ok: true, value: resolved }
}
