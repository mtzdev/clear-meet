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

/** Lê e valida o `meeting.json` de uma pasta. Nunca lança. */
export async function readMeeting(folder: string): Promise<ParseResult<MeetingFile>> {
  let text: string
  try {
    text = await readFile(join(folder, MEETING_FILE), 'utf8')
  } catch {
    return { ok: false, error: 'meeting.json não encontrado' }
  }
  return parseMeetingText(text)
}

/** Grava o `meeting.json` de forma atômica (temporário + rename). */
export async function writeMeeting(folder: string, meeting: MeetingFile): Promise<void> {
  await writeFileAtomic(join(folder, MEETING_FILE), serializeMeeting(meeting))
}

/** Pastas diretamente dentro de `root` (cada uma pode ser uma Reunião). Raiz inexistente = lista vazia. */
export async function listMeetingFolders(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
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
 */
export async function renameMeeting(
  root: string,
  folder: string,
  rawName: string
): Promise<Result<RenamedMeeting>> {
  if (!isDirectChild(root, folder)) {
    return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
  }
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
      await renameWithRetry(folder, target)
      return { ok: true, value: { folder: target, name, folderRenamed: true } }
    } catch {
      return { ok: true, value: { folder, name, folderRenamed: false } }
    }
  }
  return { ok: true, value: { folder, name, folderRenamed: false } }
}
