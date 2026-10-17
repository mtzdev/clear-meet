import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { lockFor, type MeetingDetail } from '@shared/library'
import { MEETING_FILES, type MeetingFile } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import { makeSummaryView } from '@shared/summary'
import { makeTranscriptView, type TranscriptProgress } from '@shared/transcript'
import { sameFolder } from './paths'
import { isDirectChild, listMeetingFolders, MEETING_NOT_FOUND, readMeeting } from './repository'

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
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
  activeFolder: string | null,
  transcriptProgress: (folder: string) => TranscriptProgress | null = () => null
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
      lock: lockFor(meeting.status, live),
      transcript: makeTranscriptView(meeting.transcript, transcriptProgress(folder)),
      summary: makeSummaryView(meeting.summary)
    }
  }
}
