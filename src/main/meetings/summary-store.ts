import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { MeetingFile } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import {
  parseSummaryText,
  serializeSummary,
  SUMMARY_FILE,
  type SummaryFile,
  type SummaryMeta
} from '@shared/summary'
import { writeFileAtomic } from '../fs/atomic'
import { readMeeting, withFolderLock, writeMeeting } from './repository'

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

export async function readSummary(folder: string): Promise<Result<SummaryFile | null>> {
  let text: string
  try {
    text = await readFile(join(folder, SUMMARY_FILE), 'utf8')
  } catch {
    return { ok: true, value: null }
  }
  const parsed = parseSummaryText(text)
  return parsed.ok
    ? { ok: true, value: parsed.value }
    : fail('invalid-request', `Não foi possível ler o Resumo: ${parsed.error}.`)
}

export function writeSummary(folder: string, summary: SummaryFile): Promise<void> {
  return writeFileAtomic(join(folder, SUMMARY_FILE), serializeSummary(summary))
}

export function removeSummary(folder: string): Promise<void> {
  return rm(join(folder, SUMMARY_FILE), { force: true })
}

/**
 * Atualiza o estado do Resumo no `meeting.json` (leitura-modificação-escrita sob a trava da
 * pasta, sem atropelar Anotações, Transcrição ou renomeação). `update` devolve o novo estado,
 * ou `undefined` para tirar o bloco. Devolve a Reunião gravada, ou `null` se não deu para ler.
 */
export function updateSummaryMeta(
  folder: string,
  update: (previous: SummaryMeta | undefined) => SummaryMeta | undefined
): Promise<MeetingFile | null> {
  return withFolderLock(folder, async () => {
    const read = await readMeeting(folder)
    if (!read.ok) return null
    const { summary: previous, ...rest } = read.value
    const next = update(previous)
    const meeting: MeetingFile = next ? { ...rest, summary: next } : rest
    await writeMeeting(folder, meeting)
    return meeting
  })
}
