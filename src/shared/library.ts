import type { CaptureSourceKind, MeetingIssue, MeetingNote, MeetingStatus } from './meeting'
import type { TranscriptStatus, TranscriptView } from './transcript'

/** Uma Reunião na lista. */
export interface MeetingListItem {
  id: string
  /** Caminho absoluto da pasta. */
  folder: string
  name: string
  /** ISO 8601 (UTC): início da gravação. */
  createdAt: string
  /** `null` até a gravação terminar. */
  durationMs: number | null
  status: MeetingStatus
  /** É a Reunião que está sendo gravada agora (ou finalizando). */
  live: boolean
  source: { kind: CaptureSourceKind; name: string | null }
  noteCount: number
  transcriptStatus: TranscriptStatus
}

export interface MeetingList {
  /** Mais recentes primeiro. */
  items: MeetingListItem[]
  /** Pastas com `meeting.json` ilegível ou de versão desconhecida (ignoradas, nunca alteradas). */
  skipped: number
}

/**
 * Por que a Reunião não pode ser editada (Anotações e nome):
 * - `recording`: está sendo gravada neste momento (ou foi interrompida e aguarda a Recuperação);
 * - `unfinished`: gravação encerrada, mas os arquivos finais ainda não estão prontos.
 */
export type MeetingLock = 'recording' | 'unfinished'

/** Ordem da lista: mais recentes primeiro (empate: pelo caminho, para ser estável). */
export function compareMeetingsNewestFirst(a: MeetingListItem, b: MeetingListItem): number {
  const byDate = Date.parse(b.createdAt) - Date.parse(a.createdAt)
  if (byDate !== 0) return byDate
  return a.folder.localeCompare(b.folder)
}

/** Motivo do bloqueio de edição, ou `null` se a Reunião está pronta para editar. */
export function lockFor(status: MeetingStatus, live: boolean): MeetingLock | null {
  if (live || status === 'recording') return 'recording'
  return status === 'ready' ? null : 'unfinished'
}

/** Uma Reunião aberta na tela de detalhe. */
export interface MeetingDetail {
  id: string
  folder: string
  /** Nome da pasta (sem o caminho), usado na URL de mídia. */
  folderName: string
  name: string
  createdAt: string
  durationMs: number | null
  status: MeetingStatus
  source: { kind: CaptureSourceKind; name: string | null }
  /** `video.mp4` existe na pasta. */
  hasVideoFile: boolean
  /** `audio.opus` existe na pasta. */
  hasAudioFile: boolean
  /** Proporção do Vídeo (largura / altura); `null` sem Vídeo. */
  videoAspect: number | null
  /** Ordenadas por Instante. */
  notes: MeetingNote[]
  issues: MeetingIssue[]
  lock: MeetingLock | null
  transcript: TranscriptView
}
