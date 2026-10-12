import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  compareMeetingsNewestFirst,
  lockFor,
  type MeetingDetail,
  type MeetingList,
  type MeetingListItem
} from '@shared/library'
import { MEETING_FILES, type MeetingFile } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import { sameFolder } from './paths'
import { isDirectChild, listMeetingFolders, MEETING_NOT_FOUND, readMeeting } from './repository'

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

export function toListItem(folder: string, meeting: MeetingFile, live: boolean): MeetingListItem {
  return {
    id: meeting.id,
    folder,
    name: meeting.name,
    createdAt: meeting.createdAt,
    durationMs: meeting.durationMs,
    status: meeting.status,
    live,
    source: meeting.source,
    noteCount: meeting.notes.length
  }
}

/** Pastas sem `meeting.json` são ignoradas em silêncio; as com `meeting.json` inválido entram em `skipped`. */
export async function listMeetings(
  root: string,
  activeFolder: string | null
): Promise<MeetingList> {
  const folders = await listMeetingFolders(root)
  const reads = await Promise.all(
    folders.map(async (folder) => ({ folder, read: await readMeeting(folder) }))
  )
  const items: MeetingListItem[] = []
  let skipped = 0
  for (const { folder, read } of reads) {
    if (read.ok) {
      items.push(
        toListItem(folder, read.value, activeFolder !== null && sameFolder(folder, activeFolder))
      )
    } else if (read.error !== MEETING_NOT_FOUND) {
      skipped++
    }
  }
  items.sort(compareMeetingsNewestFirst)
  return { items, skipped }
}

export async function findMeetingFolder(root: string, id: string): Promise<string | null> {
  for (const folder of await listMeetingFolders(root)) {
    const read = await readMeeting(folder)
    if (read.ok && read.value.id === id) return folder
  }
  return null
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function videoAspect(meeting: MeetingFile): number | null {
  const video = meeting.video
  return video && video.width > 0 && video.height > 0 ? video.width / video.height : null
}

export async function loadMeetingDetail(
  root: string,
  folder: string,
  activeFolder: string | null
): Promise<Result<MeetingDetail>> {
  if (!isDirectChild(root, folder)) {
    return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
  }
  const read = await readMeeting(folder)
  if (!read.ok) {
    return fail(
      read.error === MEETING_NOT_FOUND ? 'not-found' : 'invalid-request',
      read.error === MEETING_NOT_FOUND
        ? 'A Reunião não foi encontrada. Ela pode ter sido movida ou apagada.'
        : `Não foi possível ler a Reunião: ${read.error}.`
    )
  }
  const meeting = read.value
  const live = activeFolder !== null && sameFolder(folder, activeFolder)
  const [hasVideoFile, hasAudioFile] = await Promise.all([
    fileExists(join(folder, MEETING_FILES.video)),
    fileExists(join(folder, MEETING_FILES.audio))
  ])
  return {
    ok: true,
    value: {
      id: meeting.id,
      folder,
      folderName: basename(folder),
      name: meeting.name,
      createdAt: meeting.createdAt,
      durationMs: meeting.durationMs,
      status: meeting.status,
      source: meeting.source,
      hasVideoFile,
      hasAudioFile,
      videoAspect: videoAspect(meeting),
      notes: [...meeting.notes].sort((a, b) => a.offsetMs - b.offsetMs),
      issues: meeting.issues,
      lock: lockFor(meeting.status, live)
    }
  }
}
