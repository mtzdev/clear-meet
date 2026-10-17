import type { ListCompaction } from './compaction'
import type { CaptureSourceKind, MeetingIssue, MeetingNote, MeetingStatus } from './meeting'
import type { SummaryStatus, SummaryView } from './summary'
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
  /** Tamanho de todos os arquivos da pasta. */
  sizeBytes: number
  noteCount: number
  transcriptStatus: TranscriptStatus
  summaryStatus: SummaryStatus
  /** `video.mp4` existe na pasta. */
  hasVideo: boolean
  compactionStatus: ListCompaction
  /** URL da miniatura, ou `null` (sem Vídeo, ainda não gerada ou sem FFmpeg). */
  thumbnail: string | null
}

export const LIBRARY_SORTS = ['newest', 'oldest', 'longest', 'relevance'] as const
export type LibrarySort = (typeof LIBRARY_SORTS)[number]

export function isLibrarySort(value: unknown): value is LibrarySort {
  return typeof value === 'string' && (LIBRARY_SORTS as readonly string[]).includes(value)
}

/** Busca na Biblioteca: texto livre (nome e conteúdo), intervalo de datas e ordenação. */
export interface LibraryQuery {
  text: string
  /** Início (inclusive) e fim (exclusivo) em ms desde a época, sobre o início da gravação. */
  fromMs: number | null
  toMs: number | null
  sort: LibrarySort
  /** Máximo de Reuniões devolvidas; `null` = o padrão. */
  limit: number | null
}

export const DEFAULT_LIBRARY_QUERY: LibraryQuery = {
  text: '',
  fromMs: null,
  toMs: null,
  sort: 'newest',
  limit: null
}

/** Um trecho de texto, com `match` nas partes que casam com a busca. */
export interface SnippetPart {
  text: string
  match: boolean
}

export const HIT_KINDS = ['name', 'utterance', 'note', 'summary'] as const
/** Onde a busca achou o termo: nome da Reunião, Fala da Transcrição, Anotação ou Resumo. */
export type HitKind = (typeof HIT_KINDS)[number]

export interface SearchHit {
  kind: HitKind
  /** Instante do trecho (Fala, Anotação ou item do Resumo); `null` no nome e na visão geral. */
  offsetMs: number | null
  /** Falante da Fala, com o termo marcado se for ele que casou. */
  speaker: SnippetPart[] | null
  parts: SnippetPart[]
}

export interface LibraryEntry {
  meeting: MeetingListItem
  /** Melhores trechos achados (vazio sem texto na busca). */
  hits: SearchHit[]
  /** Quantos trechos casaram no total. */
  hitCount: number
}

export interface LibraryResult {
  entries: LibraryEntry[]
  /** Reuniões que casam com a busca (pode ser maior que `entries` quando há limite). */
  total: number
  /** Reuniões no índice, sem filtro: distingue "nenhuma ainda" de "nenhuma encontrada". */
  indexed: number
  /** Pastas com `meeting.json` ilegível, de versão desconhecida ou repetido (ignoradas, nunca alteradas). */
  skipped: number
  /** O índice está sendo atualizado agora. */
  updating: boolean
}

export type ListStatusKind =
  | 'recording'
  | 'interrupted'
  | 'processing'
  | 'transcribing'
  | 'summarizing'
  | 'compacting'
  | 'warning'
  | 'ready'

export interface ListStatus {
  kind: ListStatusKind
  label: string
}

/** A linha de status da lista: gravando, interrompida, processando, transcrevendo, resumindo, compactando ou pronta. */
export function listStatus(
  item: Pick<
    MeetingListItem,
    'status' | 'live' | 'transcriptStatus' | 'summaryStatus' | 'compactionStatus'
  >
): ListStatus {
  if (item.live) return { kind: 'recording', label: 'Gravando agora' }
  switch (item.status) {
    case 'recording':
      return { kind: 'interrupted', label: 'Interrompida' }
    case 'processing':
      return { kind: 'processing', label: 'Processando' }
    case 'unprocessed':
      return { kind: 'processing', label: 'Arquivos pendentes' }
    case 'ready':
      break
  }
  if (item.transcriptStatus === 'running') return { kind: 'transcribing', label: 'Transcrevendo' }
  if (item.summaryStatus === 'running') return { kind: 'summarizing', label: 'Resumindo' }
  if (item.compactionStatus === 'running') return { kind: 'compacting', label: 'Compactando…' }
  if (item.transcriptStatus === 'error') {
    return { kind: 'warning', label: 'Transcrição interrompida' }
  }
  if (item.summaryStatus === 'error') return { kind: 'warning', label: 'Resumo interrompido' }
  if (item.compactionStatus === 'error') return { kind: 'warning', label: 'Falha ao compactar' }
  return { kind: 'ready', label: 'Pronta' }
}

/**
 * Por que a Reunião não pode ser editada (Anotações e nome):
 * - `recording`: está sendo gravada neste momento (ou foi interrompida e aguarda a Recuperação);
 * - `unfinished`: gravação encerrada, mas os arquivos finais ainda não estão prontos.
 */
export type MeetingLock = 'recording' | 'unfinished'

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
  compactionStatus: ListCompaction
  /** A Reunião teve microfone ou áudio do sistema; sem nenhum, não há o que transcrever. */
  hasAudioInput: boolean
  /** Proporção do Vídeo (largura / altura); `null` sem Vídeo. */
  videoAspect: number | null
  /** Ordenadas por Instante. */
  notes: MeetingNote[]
  issues: MeetingIssue[]
  lock: MeetingLock | null
  transcript: TranscriptView
  summary: SummaryView
}

export type ListAction = 'rename' | 'delete' | 'delete-video'

/** Por que uma ação da lista (editar título, excluir) está bloqueada. */
export type ListBlock = 'recording' | 'unfinished' | 'transcribing' | 'summarizing' | 'compacting'

export const LIST_BLOCK_TEXT: Record<ListBlock, string> = {
  recording: 'Gravando agora',
  unfinished: 'Aguarde terminar de processar',
  transcribing: 'Transcrevendo agora',
  summarizing: 'Resumindo agora',
  compacting: 'Compactando agora'
}

type BlockInput = Pick<
  MeetingListItem,
  'status' | 'live' | 'transcriptStatus' | 'summaryStatus' | 'compactionStatus'
>

/**
 * Motivo para bloquear a ação sobre a Reunião da lista, ou `null` se está liberada. Renomear
 * segue o bloqueio de edição da tela da Reunião; excluir só barra o que o app está escrevendo
 * agora (uma Reunião interrompida ou com arquivos pendentes pode ser excluída). Apagar só o
 * Vídeo exige a Reunião pronta e o Vídeo fora de uso, mas não espera a IA, que lê só o áudio.
 * A Conversa em andamento só o main sabe: ele recusa o pedido com a mesma mensagem de "ocupada".
 */
export function listBlock(item: BlockInput, action: ListAction): ListBlock | null {
  if (action === 'rename') {
    const lock = lockFor(item.status, item.live)
    if (lock) return lock
  } else if (action === 'delete-video') {
    const lock = lockFor(item.status, item.live)
    if (lock) return lock
    return item.compactionStatus === 'running' ? 'compacting' : null
  } else {
    if (item.live) return 'recording'
    if (item.status === 'processing') return 'unfinished'
  }
  if (item.transcriptStatus === 'running') return 'transcribing'
  if (item.summaryStatus === 'running') return 'summarizing'
  if (item.compactionStatus === 'running') return 'compacting'
  return null
}
