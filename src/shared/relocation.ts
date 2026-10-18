/** Escolha de uma nova pasta para as Reuniões, já validada e medida pelo main. */
export interface MeetingsDirChoice {
  currentDir: string
  newDir: string
  /** Reuniões (pastas com `meeting.json`) na pasta atual. */
  meetingCount: number
  /** Tamanho total dessas Reuniões. */
  totalBytes: number
}

export interface RelocationRequest {
  /** Pasta devolvida por `meetingsDir:choose`; o main recusa qualquer outra. */
  newDir: string
  /** Move as Reuniões existentes para a nova pasta (senão só troca a pasta). */
  move: boolean
}

export type RelocationIssueReason = 'exists' | 'in-use' | 'no-space' | 'failed'

export interface RelocationIssue {
  /** Nome da pasta da Reunião. */
  name: string
  reason: RelocationIssueReason
}

export interface RelocationSummary {
  previousDir: string
  newDir: string
  /** Houve pedido para mover as Reuniões. */
  moveRequested: boolean
  total: number
  moved: number
  /** Reuniões que não saíram da pasta antiga. */
  issues: RelocationIssue[]
  /** Reuniões que nem foram tentadas porque o usuário cancelou. */
  notAttempted: number
  /** Cópia verificada, mas a pasta antiga não pôde ser apagada por inteiro. */
  leftovers: number
}

export interface RelocationProgress {
  /** Reunião em andamento (1 a `total`) e o nome da pasta. */
  current: number
  total: number
  name: string
  bytesDone: number
  bytesTotal: number
}

/** Quantas Reuniões ficaram na pasta antiga. */
export function leftBehind(summary: RelocationSummary): number {
  return summary.issues.length + summary.notAttempted
}

export const RELOCATION_REASON_TEXT: Record<RelocationIssueReason, string> = {
  exists: 'já existe uma pasta com esse nome no destino',
  'in-use': 'algum programa estava usando os arquivos',
  'no-space': 'não há espaço livre no destino',
  failed: 'não foi possível mover'
}
