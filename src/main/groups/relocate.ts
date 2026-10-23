import { copyFile, mkdir, readdir, rename, rmdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { GROUP_CHATS_DIR } from '@shared/group-chat'
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

async function moveFile(source: string, target: string, complete: boolean): Promise<void> {
  if (!complete) {
    await copyFile(source, target)
    return
  }
  try {
    await rename(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(source, target)
    await rm(source, { force: true })
  }
}

/** Leva as Conversas dos grupos (`.clearmeet/chats/*.json`); as que já existem no destino ficam como estão. */
async function moveChats(fromRoot: string, toRoot: string, complete: boolean): Promise<void> {
  const sourceDir = join(fromRoot, GROUPS_DIR, GROUP_CHATS_DIR)
  let names: string[]
  try {
    names = (await readdir(sourceDir)).filter((name) => name.toLowerCase().endsWith('.json'))
  } catch {
    return
  }
  if (names.length === 0) return
  const targetDir = join(toRoot, GROUPS_DIR, GROUP_CHATS_DIR)
  await mkdir(targetDir, { recursive: true })
  for (const name of names) {
    const target = join(targetDir, name)
    if (await exists(target)) continue
    await moveFile(join(sourceDir, name), target, complete)
  }
  if (complete) await rmdir(sourceDir).catch(() => undefined)
}

/**
 * Leva a definição dos grupos (e as Conversas deles) junto com as Reuniões para a pasta nova.
 * Move quando todas as Reuniões foram (`complete`); senão só copia, porque as que ficaram para
 * trás ainda dependem dela. Nunca sobrescreve uma definição que já existe no destino. Nunca lança.
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
    await moveFile(source, target, complete)
    await moveChats(fromRoot, toRoot, complete)
    if (complete) {
      // Só some se estiver vazia; o que mais houver nela é do usuário.
      await rmdir(join(fromRoot, GROUPS_DIR)).catch(() => undefined)
      return 'moved'
    }
    return 'copied'
  } catch {
    return 'failed'
  }
}
