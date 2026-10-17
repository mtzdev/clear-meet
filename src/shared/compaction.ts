/**
 * Situação da Compactação do Vídeo, guardada em `meeting.json` (`video.compaction`):
 * - `pending`: voltou para a fila (interrompida ou pedida de novo);
 * - `running`: em andamento (se o app fechou no meio, ao reabrir volta para `pending`);
 * - `done`: o Vídeo atual já é o compactado;
 * - `kept-original`: o compactado não ficou menor (ou não valeu); o original ficou;
 * - `error`: falhou; o original continua intacto e dá para tentar de novo.
 * Reunião sem este bloco ainda não foi compactada.
 */
export const COMPACTION_STATUSES = ['pending', 'running', 'done', 'kept-original', 'error'] as const
export type CompactionStatus = (typeof COMPACTION_STATUSES)[number]

export function isCompactionStatus(value: unknown): value is CompactionStatus {
  return typeof value === 'string' && (COMPACTION_STATUSES as readonly string[]).includes(value)
}

/** Velocidade (padrão) ou qualidade máxima: escolhe os presets do encoder. */
export const COMPACTION_MODES = ['speed', 'quality'] as const
export type CompactionMode = (typeof COMPACTION_MODES)[number]
export const DEFAULT_COMPACTION_MODE: CompactionMode = 'speed'

export function isCompactionMode(value: unknown): value is CompactionMode {
  return typeof value === 'string' && (COMPACTION_MODES as readonly string[]).includes(value)
}

export interface CompactionMeta {
  status: CompactionStatus
  /** Codec do Vídeo depois da Compactação (`av1`). */
  codec?: string
  /** Encoder usado (`libsvtav1`, `av1_nvenc`...). */
  encoder?: string
  originalBytes?: number
  finalBytes?: number
  error?: string
  updatedAt: string
}

/** Na lista, `none` = Reunião ainda sem Compactação registrada. */
export type ListCompaction = CompactionStatus | 'none'

/** A Compactação de uma Reunião mudou de estado, ou avançou (`percent`, 0 a 100). */
export interface CompactionChangedEvent {
  meetingId: string
  folder: string
  status: ListCompaction
  percent: number | null
}

/** Precisa entrar na fila? Falha só volta por pedido do usuário. */
export function needsCompaction(meta: CompactionMeta | undefined): boolean {
  return meta === undefined || meta.status === 'pending' || meta.status === 'running'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalBytes(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Lê o bloco do `meeting.json`; ausente ou inválido = sem Compactação registrada. */
export function parseCompactionMeta(raw: unknown): CompactionMeta | undefined {
  if (!isRecord(raw) || !isCompactionStatus(raw.status)) return undefined
  const updatedAt =
    typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
      ? raw.updatedAt
      : new Date(0).toISOString()
  const meta: CompactionMeta = { status: raw.status, updatedAt }
  const codec = optionalText(raw.codec)
  if (codec) meta.codec = codec
  const encoder = optionalText(raw.encoder)
  if (encoder) meta.encoder = encoder
  const originalBytes = optionalBytes(raw.originalBytes)
  if (originalBytes !== undefined) meta.originalBytes = originalBytes
  const finalBytes = optionalBytes(raw.finalBytes)
  if (finalBytes !== undefined) meta.finalBytes = finalBytes
  const error = optionalText(raw.error)
  if (error) meta.error = error
  return meta
}
