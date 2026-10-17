import type { CompactionMeta } from '@shared/compaction'
import type { MeetingFile } from '@shared/meeting'
import { readMeeting, withFolderLock, writeMeeting } from './repository'

/**
 * Atualiza o estado da Compactação no `meeting.json` (leitura-modificação-escrita sob a trava da
 * pasta, sem atropelar Anotações, Transcrição ou renomeação). `update` devolve o novo estado, ou
 * `undefined` para tirar o bloco. Devolve a Reunião gravada, ou `null` se não deu para ler ou se
 * ela não tem Vídeo.
 */
export function updateCompactionMeta(
  folder: string,
  update: (previous: CompactionMeta | undefined) => CompactionMeta | undefined
): Promise<MeetingFile | null> {
  return withFolderLock(folder, async () => {
    const read = await readMeeting(folder)
    if (!read.ok || !read.value.video) return null
    const { compaction: previous, ...video } = read.value.video
    const next = update(previous)
    const meeting: MeetingFile = {
      ...read.value,
      video: next ? { ...video, compaction: next } : video
    }
    await writeMeeting(folder, meeting)
    return meeting
  })
}
