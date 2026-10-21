import { copyFile, mkdir, rename, rmdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { GROUPS_DIR, GROUPS_FILE } from '@shared/groups'

export type GroupsMoveOutcome = 'none' | 'moved' | 'copied' | 'exists' | 'failed'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Leva a definição dos grupos junto com as Reuniões para a pasta nova. Move quando todas as
 * Reuniões foram (`complete`); senão só copia, porque as que ficaram para trás ainda dependem
 * dela. Nunca sobrescreve uma definição que já existe no destino. Nunca lança.
 */
export async function moveGroupsFile(
  fromRoot: string,
  toRoot: string,
  complete: boolean
): Promise<GroupsMoveOutcome> {
  const source = join(fromRoot, GROUPS_DIR, GROUPS_FILE)
  const targetDir = join(toRoot, GROUPS_DIR)
  const target = join(targetDir, GROUPS_FILE)
  try {
    if (!(await exists(source))) return 'none'
    if (await exists(target)) return 'exists'
    await mkdir(targetDir, { recursive: true })
    if (complete) {
      try {
        await rename(source, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        await copyFile(source, target)
        await rm(source, { force: true })
      }
      // Só some se estiver vazia; o que mais houver nela é do usuário.
      await rmdir(join(fromRoot, GROUPS_DIR)).catch(() => undefined)
      return 'moved'
    }
    await copyFile(source, target)
    return 'copied'
  } catch {
    return 'failed'
  }
}
