import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MEETING_FILE } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import type { RelocationIssue, RelocationIssueReason } from '@shared/relocation'
import { removeWithRetry, renameWithRetry } from '../fs/atomic'
import { sameFolder } from './paths'
import { isIgnoredFolderName } from './repository'

export interface RelocateOps {
  /** Move uma pasta inteira (mesmo volume). Falha com `EXDEV` entre volumes. */
  rename(from: string, to: string): Promise<void>
  /** Copia um arquivo avisando os bytes que já foram. */
  copyFile(from: string, to: string, onBytes: (bytes: number) => void): Promise<void>
  /** Apaga uma pasta e tudo o que há nela. */
  remove(path: string): Promise<void>
}

async function copyFileStreaming(
  from: string,
  to: string,
  onBytes: (bytes: number) => void
): Promise<void> {
  const info = await stat(from)
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onBytes(chunk.length)
      callback(null, chunk)
    }
  })
  await pipeline(createReadStream(from), counter, createWriteStream(to, { flags: 'wx' }))
  // Garante que a cópia está no disco antes de a original poder ser apagada.
  const handle = await open(to, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await utimes(to, info.atime, info.mtime)
}

export const DEFAULT_RELOCATE_OPS: RelocateOps = {
  rename: (from, to) => renameWithRetry(from, to),
  copyFile: copyFileStreaming,
  remove: (path) => removeWithRetry(path, { recursive: true })
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

/** `child` está estritamente dentro de `parent`? (Windows ignora maiúsculas e minúsculas.) */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Confere que `candidate` serve de nova pasta das Reuniões. Devolve o caminho normalizado. */
export async function validateNewDir(
  currentDir: string,
  candidate: unknown
): Promise<Result<string>> {
  if (typeof candidate !== 'string' || candidate.trim() === '' || !isAbsolute(candidate)) {
    return fail('invalid-request', 'Escolha uma pasta válida.')
  }
  const target = resolve(candidate)
  if (sameFolder(target, currentDir)) {
    return fail('invalid-request', 'Essa já é a pasta das Reuniões. Escolha outra.')
  }
  if (isInside(currentDir, target)) {
    return fail('invalid-request', 'A nova pasta não pode ficar dentro da pasta atual.')
  }
  if (isInside(target, currentDir)) {
    return fail('invalid-request', 'A pasta atual não pode ficar dentro da nova pasta.')
  }
  if (!(await isDirectory(target))) {
    return fail('not-found', 'A pasta escolhida não existe.')
  }
  const probe = join(target, `.clearmeet-teste-${process.pid}-${Date.now()}.tmp`)
  try {
    await writeFile(probe, '')
    await rm(probe, { force: true })
  } catch {
    return fail('invalid-request', 'Não é possível gravar nessa pasta. Escolha outra.')
  }
  return { ok: true, value: target }
}

export interface MeetingFolderInfo {
  name: string
  folder: string
  bytes: number
}

/** Lista os itens de uma pasta (recursivamente) com o tamanho de cada arquivo. */
async function walk(root: string): Promise<Map<string, number>> {
  const files = new Map<string, number>()
  const visit = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.set(`${rel}/`, 0)
        await visit(full, rel)
      } else if (entry.isFile()) {
        files.set(rel, (await stat(full)).size)
      } else {
        throw new Error(`Item não suportado: ${rel}`)
      }
    }
  }
  await visit(root, '')
  return files
}

async function sizeOf(folder: string): Promise<number> {
  try {
    let total = 0
    for (const size of (await walk(folder)).values()) total += size
    return total
  } catch {
    return 0
  }
}

/** Reuniões (pastas com `meeting.json`) diretamente dentro de `root`, em ordem de nome. */
export async function listMeetingFolders(root: string): Promise<MeetingFolderInfo[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found: MeetingFolderInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredFolderName(entry.name)) continue
    const folder = join(root, entry.name)
    if (!(await isFile(join(folder, MEETING_FILE)))) continue
    found.push({ name: entry.name, folder, bytes: await sizeOf(folder) })
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

const IN_USE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

function reasonFor(error: unknown): RelocationIssueReason {
  const code = errorCode(error)
  if (code === 'ENOSPC') return 'no-space'
  if (code !== undefined && IN_USE_CODES.has(code)) return 'in-use'
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return 'exists'
  return 'failed'
}

async function copyTree(
  from: string,
  to: string,
  ops: RelocateOps,
  onBytes: (bytes: number) => void
): Promise<void> {
  await mkdir(to)
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await copyTree(source, target, ops, onBytes)
    else if (entry.isFile()) await ops.copyFile(source, target, onBytes)
    else throw new Error(`Item não suportado: ${entry.name}`)
  }
}

async function verifyCopy(from: string, to: string): Promise<void> {
  const [source, copy] = await Promise.all([walk(from), walk(to)])
  if (source.size !== copy.size) throw new Error('A cópia não tem os mesmos arquivos')
  for (const [name, size] of source) {
    if (copy.get(name) !== size) throw new Error(`A cópia de ${name} não confere`)
  }
}

type MoveOutcome =
  { status: 'moved'; leftover: boolean } | { status: 'skipped'; reason: RelocationIssueReason }

/**
 * Move uma pasta de Reunião: `rename` (mesmo volume) ou, entre volumes, copia, confere e só
 * então apaga a original. Se algo falhar, a cópia parcial é descartada e a original fica intacta.
 */
async function moveFolder(
  source: string,
  target: string,
  bytes: number,
  ops: RelocateOps,
  onBytes: (bytes: number) => void
): Promise<MoveOutcome> {
  try {
    await stat(target)
    return { status: 'skipped', reason: 'exists' }
  } catch {
    // Não existe: pode mover.
  }
  try {
    await ops.rename(source, target)
    onBytes(bytes)
    return { status: 'moved', leftover: false }
  } catch (error) {
    if (errorCode(error) !== 'EXDEV') return { status: 'skipped', reason: reasonFor(error) }
  }

  try {
    await copyTree(source, target, ops, onBytes)
    await verifyCopy(source, target)
  } catch (error) {
    await ops.remove(target).catch(() => undefined)
    return { status: 'skipped', reason: reasonFor(error) }
  }
  try {
    await ops.remove(source)
  } catch {
    return { status: 'moved', leftover: true }
  }
  return { status: 'moved', leftover: false }
}

export interface RelocateProgress {
  current: number
  total: number
  name: string
  bytesDone: number
  bytesTotal: number
}

export interface RelocateOptions {
  to: string
  meetings: readonly MeetingFolderInfo[]
  ops?: RelocateOps
  /** Consultado antes de cada Reunião; verdadeiro encerra o restante. */
  shouldCancel?: () => boolean
  onProgress?: (progress: RelocateProgress) => void
  now?: () => number
  log?: (message: string) => void
}

export interface RelocateResult {
  moved: number
  issues: RelocationIssue[]
  notAttempted: number
  leftovers: number
}

const PROGRESS_INTERVAL_MS = 100

/** Move as Reuniões, uma por vez, seguindo adiante quando uma falha. */
export async function relocateMeetings(options: RelocateOptions): Promise<RelocateResult> {
  const ops = options.ops ?? DEFAULT_RELOCATE_OPS
  const now = options.now ?? Date.now
  const bytesTotal = options.meetings.reduce((sum, meeting) => sum + meeting.bytes, 0)
  const result: RelocateResult = { moved: 0, issues: [], notAttempted: 0, leftovers: 0 }
  let finishedBytes = 0
  let lastEmit = 0

  for (const [index, meeting] of options.meetings.entries()) {
    if (options.shouldCancel?.()) {
      result.notAttempted = options.meetings.length - index
      break
    }
    let partial = 0
    const report = (force: boolean): void => {
      const at = now()
      if (!force && at - lastEmit < PROGRESS_INTERVAL_MS) return
      lastEmit = at
      options.onProgress?.({
        current: index + 1,
        total: options.meetings.length,
        name: meeting.name,
        bytesDone: Math.min(bytesTotal, finishedBytes + partial),
        bytesTotal
      })
    }
    report(true)
    const outcome = await moveFolder(
      meeting.folder,
      join(options.to, meeting.name),
      meeting.bytes,
      ops,
      (bytes) => {
        partial += bytes
        report(false)
      }
    )
    finishedBytes += meeting.bytes
    partial = 0
    if (outcome.status === 'moved') {
      result.moved += 1
      if (outcome.leftover) result.leftovers += 1
    } else {
      options.log?.(`[pasta] não moveu "${meeting.name}": ${outcome.reason}`)
      result.issues.push({ name: meeting.name, reason: outcome.reason })
    }
    report(true)
  }
  return result
}
