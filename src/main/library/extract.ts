import type { HitKind } from '@shared/library'
import { meetingTags, type MeetingFile } from '@shared/meeting'
import type { SummaryFile } from '@shared/summary'
import { labelFor, type TranscriptFile } from '@shared/transcript'
import type { FragmentInput, MeetingRow } from './db'
import type { FolderScan } from './scan'

export function buildRow(folderName: string, meeting: MeetingFile, scan: FolderScan): MeetingRow {
  return {
    id: meeting.id,
    folderName,
    name: meeting.name,
    createdAt: meeting.createdAt,
    createdMs: Date.parse(meeting.createdAt),
    durationMs: meeting.durationMs === null ? null : Math.round(meeting.durationMs),
    status: meeting.status,
    sourceKind: meeting.source.kind,
    sourceName: meeting.source.name,
    sizeBytes: scan.sizeBytes,
    noteCount: meeting.notes.length,
    transcriptStatus: meeting.transcript?.status ?? 'none',
    summaryStatus: meeting.summary?.status ?? 'none',
    hasVideo: scan.videoSig !== null,
    compactionStatus: meeting.video?.compaction?.status ?? 'none',
    videoSig: scan.videoSig,
    signature: scan.signature
  }
}

function fragment(
  kind: HitKind,
  offsetMs: number | null,
  body: string,
  speaker: string | null = null
): FragmentInput | null {
  const text = body.trim()
  return text === ''
    ? null
    : { kind, offsetMs: offsetMs === null ? null : Math.round(offsetMs), speaker, body: text }
}

/**
 * Tudo o que a busca encontra: nome, Tags, Falas (com Falante e Instante), Anotações e Resumo. Os
 * itens do Resumo apontam para o primeiro Instante que citam.
 */
export function buildFragments(
  meeting: MeetingFile,
  transcript: TranscriptFile | null,
  summary: SummaryFile | null
): FragmentInput[] {
  const found: (FragmentInput | null)[] = [fragment('name', null, meeting.name)]
  for (const tag of meetingTags(meeting)) found.push(fragment('tag', null, tag))
  if (transcript) {
    for (const utterance of transcript.utterances) {
      found.push(
        fragment(
          'utterance',
          utterance.startMs,
          utterance.text,
          labelFor(transcript.speakers, utterance.speakerId)
        )
      )
    }
  }
  for (const note of meeting.notes) found.push(fragment('note', note.offsetMs, note.text))
  if (summary) {
    found.push(fragment('summary', null, summary.overview))
    for (const item of [...summary.keyPoints, ...summary.decisions]) {
      found.push(fragment('summary', item.at[0] ?? null, item.text))
    }
    for (const action of summary.actions) {
      const text = [action.owner ? `${action.owner}:` : null, action.task, action.due]
        .filter(Boolean)
        .join(' ')
      found.push(fragment('summary', action.at[0] ?? null, text))
    }
  }
  return found.filter((item): item is FragmentInput => item !== null)
}
