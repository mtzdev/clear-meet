import { randomUUID } from 'node:crypto'
import { lstat, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { MEETING_FILE } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import { removeWithRetry, renameWithRetry } from '../fs/atomic'
import { isDirectChild, isStagingName, STAGING_PREFIX, withFolderLock } from './repository'

export interface DeleteOps {
  renameFolder(from: string, to: string): Promise<void>
  removeFolder(folder: string): Promise<void>
}

const DEFAULT_OPS: DeleteOps = {
  renameFolder: (from, to) => renameWithRetry(from, to),
  removeFolder: (folder) => removeWithRetry(folder, { recursive: true })
}

const IN_USE = 'Não foi possível excluir: algum programa está usando a pasta da Reunião.'

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

/**
 * Exclui a pasta da Reunião de forma definitiva. Primeiro a pasta é renomeada: no Windows isso
 * só funciona se nenhum arquivo dentro dela está aberto, então ou a Reunião sai por inteiro ou
 * nada muda (nunca sobra uma pasta com parte dos arquivos). Só depois o conteúdo é apagado.
 */
export function deleteMeetingFolder(
  root: string,
  folder: unknown,
  ops: DeleteOps = DEFAULT_OPS
): Promise<Result<null>> {
  if (typeof folder !== 'string') {
    return Promise.resolve(
      fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    )
  }
  return withFolderLock(folder, async () => {
    const checked = await checkMeetingFolder(root, folder)
    if (!checked.ok) return checked

    const staging = join(resolve(root), `${STAGING_PREFIX}${randomUUID()}`)
    try {
      await ops.renameFolder(checked.value, staging)
    } catch {
      return fail('busy', IN_USE)
    }
    try {
      await ops.removeFolder(staging)
    } catch {
      // Devolve o nome para a Reunião não virar uma pasta escondida; o que sobrou continua visível.
      await ops.renameFolder(staging, checked.value).catch(() => undefined)
      return fail('busy', IN_USE)
    }
    return { ok: true, value: null }
  })
}
