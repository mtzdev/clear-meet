import type { MeetingIssue, MeetingStatus } from '@shared/meeting'
import type { MeetingLock } from '@shared/library'
import { formatInstant } from '@shared/timeline'

export function issueText(issue: MeetingIssue): string {
  switch (issue.code) {
    case 'video-encoder-stalled':
      return `O vídeo parou de ser gravado em ${formatInstant(issue.atMs)}. O áudio continuou.`
  }
}

export const SOURCE_KIND_LABEL = {
  screen: 'Tela',
  window: 'Janela',
  none: 'Só áudio'
} as const

/** Rótulo do status de uma Reunião que ainda não está pronta (`ready` não precisa de rótulo). */
export function statusLabel(status: MeetingStatus, live: boolean): string | null {
  if (live) return 'Gravando agora'
  switch (status) {
    case 'ready':
      return null
    case 'recording':
      return 'Gravação interrompida'
    case 'processing':
      return 'Processando'
    case 'unprocessed':
      return 'Arquivos pendentes'
  }
}

export const LOCK_TEXT: Record<MeetingLock, { title: string; detail: string }> = {
  recording: {
    title: 'Esta Reunião ainda está sendo gravada',
    detail:
      'Se a gravação foi interrompida, o app a recupera ao abrir. Anotações e renomeação ficam disponíveis quando ela terminar.'
  },
  unfinished: {
    title: 'Os arquivos desta Reunião ainda não estão prontos',
    detail:
      'O pós-processamento não terminou. Nada foi perdido: o app tenta de novo ao abrir. Anotações e renomeação ficam disponíveis quando ele concluir.'
  }
}
