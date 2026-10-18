import {
  leftBehind,
  RELOCATION_REASON_TEXT,
  type RelocationProgress,
  type RelocationSummary
} from '@shared/relocation'
import { formatBytes } from './format'

export function meetingsCount(count: number): string {
  return `${count} ${count === 1 ? 'Reunião' : 'Reuniões'}`
}

/** Pergunta do diálogo que antecede a troca de pasta. */
export function moveQuestion(count: number, bytes: number): string {
  return `Mover ${meetingsCount(count)} (${formatBytes(bytes)}) para a nova pasta?`
}

/** Porcentagem (0 a 100) do que já foi movido, pelos bytes. */
export function relocationPercent(progress: RelocationProgress): number {
  if (progress.bytesTotal <= 0) {
    return progress.total > 0 ? Math.floor(((progress.current - 1) / progress.total) * 100) : 0
  }
  return Math.min(100, Math.floor((progress.bytesDone / progress.bytesTotal) * 100))
}

export interface RelocationReport {
  title: string
  lines: string[]
  /** Há Reuniões (ou sobras) na pasta antiga: oferece abri-la. */
  showPreviousDir: boolean
}

const MAX_LISTED = 5

/** Resumo final da troca de pasta, em texto para o usuário. */
export function describeRelocation(summary: RelocationSummary): RelocationReport {
  if (!summary.moveRequested) {
    return {
      title: 'Pasta trocada',
      lines: [
        `O ClearMeet agora usa ${summary.newDir}.`,
        'As Reuniões que já existiam continuam na pasta anterior e não aparecem na lista.'
      ],
      showPreviousDir: true
    }
  }

  const left = leftBehind(summary)
  const lines: string[] = []
  if (left === 0) {
    if (summary.total === 0) {
      return {
        title: 'Pasta trocada',
        lines: [`O ClearMeet agora usa ${summary.newDir}.`],
        showPreviousDir: false
      }
    }
    lines.push(`O ClearMeet agora usa ${summary.newDir}.`)
    if (summary.leftovers > 0) {
      lines.push(
        'Alguns arquivos não puderam ser apagados da pasta anterior (estavam em uso). Já estão copiados na nova pasta e podem ser apagados à mão.'
      )
    }
    return {
      title: `${meetingsCount(summary.moved)} ${summary.moved === 1 ? 'movida' : 'movidas'}`,
      lines,
      showPreviousDir: summary.leftovers > 0
    }
  }

  lines.push(
    `${summary.moved} de ${summary.total} foram movidas. ${meetingsCount(left)} ${left === 1 ? 'ficou' : 'ficaram'} na pasta anterior, que não aparece na lista.`
  )
  if (summary.notAttempted > 0) lines.push('Você interrompeu a troca antes do fim.')
  for (const issue of summary.issues.slice(0, MAX_LISTED)) {
    lines.push(`${issue.name}: ${RELOCATION_REASON_TEXT[issue.reason]}.`)
  }
  if (summary.issues.length > MAX_LISTED) {
    lines.push(`E mais ${summary.issues.length - MAX_LISTED}.`)
  }
  lines.push(`O ClearMeet agora usa ${summary.newDir}.`)
  return { title: 'Nem todas as Reuniões foram movidas', lines, showPreviousDir: true }
}
