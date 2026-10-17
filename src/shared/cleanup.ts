import { listBlock, type MeetingListItem } from './library'

/** Limpeza: só o Vídeo (a Reunião segue navegável pelo Áudio da reunião) ou a Reunião inteira. */
export const CLEANUP_MODES = ['video', 'meeting'] as const
export type CleanupMode = (typeof CLEANUP_MODES)[number]

export function isCleanupMode(value: unknown): value is CleanupMode {
  return typeof value === 'string' && (CLEANUP_MODES as readonly string[]).includes(value)
}

/** Idades sugeridas na tela, em dias. */
export const CLEANUP_PRESET_DAYS = [30, 60, 90] as const
export const CLEANUP_MIN_DAYS = 1
export const CLEANUP_MAX_DAYS = 3650

const DAY_MS = 24 * 60 * 60 * 1000

export interface CleanupRequest {
  /** Só Reuniões gravadas há mais dias que isto. */
  olderThanDays: number
  mode: CleanupMode
}

/** O pedido vem da UI: confere a forma antes de usar. */
export function parseCleanupRequest(raw: unknown): CleanupRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { olderThanDays, mode } = raw as Record<string, unknown>
  if (
    typeof olderThanDays !== 'number' ||
    !Number.isInteger(olderThanDays) ||
    olderThanDays < CLEANUP_MIN_DAYS ||
    olderThanDays > CLEANUP_MAX_DAYS ||
    !isCleanupMode(mode)
  ) {
    return null
  }
  return { olderThanDays, mode }
}

/** Reuniões iniciadas antes deste instante (ms) entram na Limpeza. */
export function cleanupCutoffMs(nowMs: number, olderThanDays: number): number {
  return nowMs - olderThanDays * DAY_MS
}

export interface CleanupPreview {
  /** Reuniões que serão mexidas. */
  count: number
  /** Espaço que será liberado. */
  bytes: number
  /** Reuniões do período que ficam de fora porque estão em uso. */
  skipped: number
  /** Idade em dias da Reunião mais antiga, para explicar uma prévia vazia; `null` sem Reuniões. */
  oldestDays: number | null
}

export interface CleanupResult {
  removed: number
  freedBytes: number
  /** Em uso (gravando, com IA ou compactando) quando a Limpeza passou por elas. */
  skipped: number
  /** Não saíram do lugar (arquivo em uso por outro programa, por exemplo). */
  failed: number
}

export type CleanupVerdict = 'ignore' | 'busy' | 'eligible'

type CleanupInput = Pick<
  MeetingListItem,
  'status' | 'live' | 'transcriptStatus' | 'summaryStatus' | 'compactionStatus' | 'hasVideo'
>

/**
 * O que a Limpeza faz com uma Reunião já dentro do período:
 * - `ignore`: não tem o que apagar nesse modo (sem Vídeo);
 * - `busy`: está sendo gravada, processada ou usada pela IA ou pela Compactação;
 * - `eligible`: pode ir para a Lixeira.
 * Só Reuniões prontas entram: uma gravação interrompida espera a Recuperação.
 */
export function cleanupVerdict(item: CleanupInput, mode: CleanupMode): CleanupVerdict {
  if (mode === 'video' && !item.hasVideo) return 'ignore'
  if (item.status !== 'ready') return 'busy'
  return listBlock(item, mode === 'video' ? 'delete-video' : 'delete') === null
    ? 'eligible'
    : 'busy'
}
