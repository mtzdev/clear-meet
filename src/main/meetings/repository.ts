import { randomUUID } from 'node:crypto'
import { access, readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import {
  MEETING_FILE,
  parseMeetingText,
  serializeMeeting,
  type MeetingFile,
  type ParseResult
} from '@shared/meeting'
import type { RecordingError, RenamedMeeting, Result } from '@shared/recording'
import { renameWithRetry, writeFileAtomic } from '../fs/atomic'
import { meetingFolderBase, sanitizeName, withSuffix } from './folder-name'

export function newMeetingId(): string {
  return randomUUID()
}

/** Erro de `readMeeting` quando a pasta não tem `meeting.json` (não é uma Reunião). */
export const MEETING_NOT_FOUND = 'meeting.json não encontrado'

const folderLocks = new Map<string, Promise<unknown>>()

function lockKey(folder: string): string {
  const resolved = resolve(folder)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Executa `task` depois de todas as tarefas anteriores da mesma pasta: leituras-modificações-
 * escritas do `meeting.json` (Anotações, nome) nunca se atropelam e nenhuma perde a outra.
 */
export function withFolderLock<T>(folder: string, task: () => Promise<T>): Promise<T> {
  const key = lockKey(folder)
  const previous = folderLocks.get(key) ?? Promise.resolve()
  const run = previous.then(task, task)
  const tail = run.catch(() => undefined)
  folderLocks.set(key, tail)
  void tail.then(() => {
    if (folderLocks.get(key) === tail) folderLocks.delete(key)
  })
  return run
}

/** Lê e valida o `meeting.json` de uma pasta. Nunca lança. */
export async function readMeeting(folder: string): Promise<ParseResult<MeetingFile>> {
  let text: string
  try {
    text = await readFile(join(folder, MEETING_FILE), 'utf8')
  } catch {
    return { ok: false, error: MEETING_NOT_FOUND }
  }
  return parseMeetingText(text)
}

/** Grava o `meeting.json` de forma atômica (temporário + rename). */
export async function writeMeeting(folder: string, meeting: MeetingFile): Promise<void> {
  await writeFileAtomic(join(folder, MEETING_FILE), serializeMeeting(meeting))
}

/** Prefixo da pasta temporária em que uma Reunião fica enquanto é excluída; as listagens a ignoram. */
export const STAGING_PREFIX = '.excluindo-'

export function isStagingName(name: string): boolean {
  return name.startsWith(STAGING_PREFIX)
}

/** Pastas diretamente dentro de `root` (cada uma pode ser uma Reunião). Raiz inexistente = lista vazia. */
export async function listMeetingFolders(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !isStagingName(entry.name))
      .map((entry) => join(root, entry.name))
  } catch {
    return []
  }
}

/** `folder` é filho direto de `root`? Barra caminhos vindos da UI que apontem para fora das Reuniões. */
export function isDirectChild(root: string, folder: string): boolean {
  const rel = relative(resolve(root), resolve(folder))
  return rel !== '' && !rel.startsWith('..') && !rel.includes(sep) && !rel.includes(':')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

/**
 * Renomeia a Reunião: o nome vai para o `meeting.json` (a verdade) e a pasta é renomeada
 * para refletir o novo nome (`AAAA-MM-DD HHMM - Nome`, com a data de início). No Windows
 * uma pasta com arquivo aberto (antivírus, indexador, player) não renomeia; nesse caso o
 * nome fica salvo no `meeting.json`, a pasta mantém o nome antigo e `folderRenamed` é `false`.
 * `renameFolder` existe para os testes simularem a pasta em uso.
 */
export function renameMeeting(
  root: string,
  folder: string,
  rawName: string,
  renameFolder: (from: string, to: string) => Promise<void> = renameWithRetry
): Promise<Result<RenamedMeeting>> {
  if (!isDirectChild(root, folder)) {
    return Promise.resolve(
      fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    )
  }
  return withFolderLock(folder, () => renameLocked(folder, rawName, renameFolder))
}

async function renameLocked(
  folder: string,
  rawName: string,
  renameFolder: (from: string, to: string) => Promise<void>
): Promise<Result<RenamedMeeting>> {
  const name = rawName.replace(/\s+/g, ' ').trim()
  if (name === '') return fail('invalid-request', 'O nome da Reunião não pode ficar vazio.')

  const read = await readMeeting(folder)
  if (!read.ok) return fail('invalid-request', read.error)
  const meeting = { ...read.value, name }
  await writeMeeting(folder, meeting)

  const base = meetingFolderBase(new Date(meeting.createdAt), sanitizeName(name))
  const parent = dirname(resolve(folder))
  if (basename(folder) === base) return { ok: true, value: { folder, name, folderRenamed: true } }

  for (let attempt = 1; attempt < 100; attempt++) {
    const target = join(parent, withSuffix(base, attempt))
    if (basename(target) === basename(folder)) {
      return { ok: true, value: { folder, name, folderRenamed: true } }
    }
    if (await exists(target)) continue
    try {
      await renameFolder(folder, target)
      return { ok: true, value: { folder: target, name, folderRenamed: true } }
    } catch {
      return { ok: true, value: { folder, name, folderRenamed: false } }
    }
  }
  return { ok: true, value: { folder, name, folderRenamed: false } }
}
