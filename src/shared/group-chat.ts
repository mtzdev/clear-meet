import {
  MAX_STORED_MESSAGES,
  isRecord,
  parseChatMessage,
  type ChatMessage,
  type ChatPending,
  type ChatSent
} from './chat'

/** Subpasta de `.clearmeet` com uma Conversa por grupo (`<id do grupo>.json`). */
export const GROUP_CHATS_DIR = 'chats'
export const GROUP_CHAT_SCHEMA_VERSION = 1

/** Teto absoluto de Reuniões numa pergunta, qualquer que seja o escopo. */
export const MAX_SCOPE_MEETINGS = 12
export const SCOPE_PERIOD_OPTIONS = [7, 30, 90, null] as const
export const SCOPE_MAX_OPTIONS = [3, 5, 8, 12] as const
export const DEFAULT_PERIOD_DAYS = 30
export const DEFAULT_MAX_MEETINGS = 5
/** Marcações manuais guardadas por lista; o resto é descartado. */
const MAX_OVERRIDES = 100
const DAY_MS = 86_400_000

/**
 * Escopo de uma pergunta ao grupo: as `maxMeetings` Reuniões mais recentes dos últimos
 * `periodDays` dias (`null` = sem limite de tempo), ajustadas à mão: `include` põe Reuniões que
 * o filtro deixaria de fora e `exclude` tira as que ele pegaria.
 */
export interface GroupScope {
  periodDays: number | null
  maxMeetings: number
  include: string[]
  exclude: string[]
}

export const DEFAULT_SCOPE: GroupScope = {
  periodDays: DEFAULT_PERIOD_DAYS,
  maxMeetings: DEFAULT_MAX_MEETINGS,
  include: [],
  exclude: []
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter((item): item is string => typeof item === 'string' && item !== '')
  return [...new Set(ids)].slice(0, MAX_OVERRIDES)
}

/** Lê o escopo vindo de um arquivo ou da UI; cada campo inválido volta ao padrão. */
export function parseScope(raw: unknown): GroupScope {
  const source = isRecord(raw) ? raw : {}
  const period = source.periodDays
  const periodDays =
    period === null
      ? null
      : typeof period === 'number' &&
          (SCOPE_PERIOD_OPTIONS as readonly (number | null)[]).includes(period)
        ? period
        : DEFAULT_PERIOD_DAYS
  const max = source.maxMeetings
  const maxMeetings =
    typeof max === 'number' && (SCOPE_MAX_OPTIONS as readonly number[]).includes(max)
      ? max
      : DEFAULT_MAX_MEETINGS
  const exclude = idList(source.exclude)
  const blocked = new Set(exclude)
  return {
    periodDays,
    maxMeetings,
    include: idList(source.include).filter((id) => !blocked.has(id)),
    exclude
  }
}

/** Uma Reunião do grupo, como o escopo a enxerga. */
export interface ScopeCandidate {
  id: string
  name: string
  /** ISO 8601 (UTC): início da gravação. */
  createdAt: string
  durationMs: number | null
  /** Reunião pronta, com a Transcrição pronta. */
  hasTranscript: boolean
}

function startMs(candidate: ScopeCandidate): number {
  const value = Date.parse(candidate.createdAt)
  return Number.isNaN(value) ? 0 : value
}

function newestFirst(candidates: readonly ScopeCandidate[]): ScopeCandidate[] {
  return [...candidates].sort((a, b) => startMs(b) - startMs(a) || a.id.localeCompare(b.id))
}

/** As Reuniões que o período e o máximo escolhem sozinhos (sem as marcações manuais). */
export function autoSelection(
  candidates: readonly ScopeCandidate[],
  scope: GroupScope,
  nowMs: number
): ScopeCandidate[] {
  const cutoff = scope.periodDays === null ? -Infinity : nowMs - scope.periodDays * DAY_MS
  return newestFirst(candidates)
    .filter((candidate) => startMs(candidate) >= cutoff)
    .slice(0, scope.maxMeetings)
}

export interface ScopeResolution {
  /** Tudo o que o escopo pega, da mais recente para a mais antiga. */
  chosen: ScopeCandidate[]
  /** As que seguem para a IA (têm Transcrição). */
  selected: ScopeCandidate[]
  /** As escolhidas que ficam de fora por falta de Transcrição. */
  missing: ScopeCandidate[]
  /** Passaria do teto de Reuniões: só as mais recentes entram. */
  capped: boolean
}

export function resolveScope(
  candidates: readonly ScopeCandidate[],
  scope: GroupScope,
  nowMs: number
): ScopeResolution {
  const picked = new Set(autoSelection(candidates, scope, nowMs).map((candidate) => candidate.id))
  for (const id of scope.include) picked.add(id)
  for (const id of scope.exclude) picked.delete(id)
  const all = newestFirst(candidates).filter((candidate) => picked.has(candidate.id))
  const chosen = all.slice(0, MAX_SCOPE_MEETINGS)
  return {
    chosen,
    selected: chosen.filter((candidate) => candidate.hasTranscript),
    missing: chosen.filter((candidate) => !candidate.hasTranscript),
    capped: all.length > MAX_SCOPE_MEETINGS
  }
}

/** Marca ou desmarca uma Reunião na mão, só guardando o que difere da escolha automática. */
export function setMeetingIncluded(
  scope: GroupScope,
  candidates: readonly ScopeCandidate[],
  nowMs: number,
  id: string,
  included: boolean
): GroupScope {
  const auto = autoSelection(candidates, scope, nowMs).some((candidate) => candidate.id === id)
  const include = scope.include.filter((item) => item !== id)
  const exclude = scope.exclude.filter((item) => item !== id)
  if (included && !auto) include.push(id)
  if (!included && auto) exclude.push(id)
  return { ...scope, include, exclude }
}

function shortDate(date: Date, withYear: boolean): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const base = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
  return withYear ? `${base}/${date.getFullYear()}` : base
}

/** `5 Reuniões · 14/10 a 21/10`; o ano aparece só quando o intervalo cruza anos. */
export function scopeSummaryText(selected: readonly ScopeCandidate[]): string {
  if (selected.length === 0) return 'Nenhuma Reunião'
  const times = selected.map(startMs)
  const first = new Date(Math.min(...times))
  const last = new Date(Math.max(...times))
  const count = selected.length === 1 ? '1 Reunião' : `${selected.length} Reuniões`
  const withYear = first.getFullYear() !== last.getFullYear()
  const from = shortDate(first, withYear)
  const to = shortDate(last, withYear)
  return `${count} · ${from === to ? from : `${from} a ${to}`}`
}

// --- Conversa ----------------------------------------------------------------------------------

/**
 * O que a IA recebeu de uma Reunião:
 * - `full`: Resumo e Transcrição inteira;
 * - `excerpts`: Resumo e os trechos mais relevantes (a Transcrição não coube);
 * - `summary`: só o Resumo;
 * - `header`: só o título e a data.
 */
export const CONTEXT_LEVELS = ['full', 'excerpts', 'summary', 'header'] as const
export type ContextLevel = (typeof CONTEXT_LEVELS)[number]

export const CONTEXT_LEVEL_LABEL: Record<ContextLevel, string> = {
  full: 'Transcrição completa',
  excerpts: 'Resumo e trechos',
  summary: 'Só o Resumo',
  header: 'Só o título'
}

/** Uma Reunião usada numa resposta, com o rótulo (`R2`) que a IA usa para citá-la. */
export interface ScopeRef {
  id: string
  label: number
  name: string
  createdAt: string
  durationMs: number | null
  level: ContextLevel
}

/** Quão relevante a Reunião é para a pergunta e em que Instantes (melhores primeiro) ela casa. */
export interface MeetingRelevance {
  score: number
  offsets: readonly number[]
}

export interface GroupChatMessage extends ChatMessage {
  /** Reuniões em que a resposta se baseou (só nas respostas). */
  scope?: ScopeRef[]
}

export interface GroupChatFile {
  schemaVersion: typeof GROUP_CHAT_SCHEMA_VERSION
  scope: GroupScope
  /** Rótulo de cada Reunião nesta Conversa: fixo, para as citações antigas continuarem valendo. */
  labels: Record<string, number>
  messages: GroupChatMessage[]
}

export const EMPTY_GROUP_CHAT: GroupChatFile = {
  schemaVersion: GROUP_CHAT_SCHEMA_VERSION,
  scope: DEFAULT_SCOPE,
  labels: {},
  messages: []
}

export interface GroupChatState {
  messages: GroupChatMessage[]
  pending: ChatPending | null
  /** Reuniões da resposta em geração (para as citações virarem links durante a geração). */
  pendingScope: ScopeRef[]
  scope: GroupScope
}

export interface GroupChatSent extends ChatSent {
  /** Reuniões em que a resposta que vai chegar se baseia. */
  scope: ScopeRef[]
}

export type GroupChatEvent =
  | { type: 'delta'; groupId: string; messageId: string; text: string }
  | { type: 'done'; groupId: string; messageId: string; message: GroupChatMessage | null }
  | { type: 'error'; groupId: string; messageId: string; message: string }

function parseRef(item: unknown): ScopeRef | null {
  if (
    !isRecord(item) ||
    typeof item.id !== 'string' ||
    typeof item.label !== 'number' ||
    !Number.isInteger(item.label) ||
    item.label < 1 ||
    typeof item.name !== 'string' ||
    typeof item.createdAt !== 'string' ||
    !(CONTEXT_LEVELS as readonly unknown[]).includes(item.level)
  ) {
    return null
  }
  const duration = item.durationMs
  return {
    id: item.id,
    label: item.label,
    name: item.name,
    createdAt: item.createdAt,
    durationMs: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
    level: item.level as ContextLevel
  }
}

function parseGroupMessage(item: unknown): GroupChatMessage | null {
  const message = parseChatMessage(item)
  if (!message) return null
  const raw = (item as Record<string, unknown>).scope
  if (Array.isArray(raw)) {
    const scope = raw.map(parseRef).filter((ref): ref is ScopeRef => ref !== null)
    if (scope.length > 0) return { ...message, scope }
  }
  return message
}

function parseLabels(raw: unknown): Record<string, number> {
  const labels: Record<string, number> = {}
  if (!isRecord(raw)) return labels
  for (const [id, label] of Object.entries(raw)) {
    if (typeof label === 'number' && Number.isInteger(label) && label >= 1) labels[id] = label
  }
  return labels
}

/**
 * Lê o arquivo da Conversa do grupo com tolerância: o que não faz sentido (mensagem, escopo,
 * rótulo) é descartado em vez de recusar o arquivo. `null` = não é um arquivo desta versão.
 */
export function parseGroupChat(raw: unknown): GroupChatFile | null {
  if (!isRecord(raw) || raw.schemaVersion !== GROUP_CHAT_SCHEMA_VERSION) return null
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map(parseGroupMessage)
        .filter((message): message is GroupChatMessage => message !== null)
        .slice(-MAX_STORED_MESSAGES)
    : []
  return {
    schemaVersion: GROUP_CHAT_SCHEMA_VERSION,
    scope: parseScope(raw.scope),
    labels: parseLabels(raw.labels),
    messages
  }
}

export function serializeGroupChat(chat: GroupChatFile): string {
  return `${JSON.stringify(chat, null, 2)}\n`
}

/**
 * Rótulos das Reuniões numa Conversa: as que já têm mantêm o número; as novas recebem os
 * seguintes, da mais antiga para a mais recente. Devolve só o que mudou em `added`.
 */
export function assignLabels(
  labels: Readonly<Record<string, number>>,
  meetings: readonly { id: string; createdAt: string }[]
): { labels: Record<string, number>; added: boolean } {
  const next = { ...labels }
  let top = Math.max(0, ...Object.values(next))
  let added = false
  const fresh = meetings
    .filter((meeting) => next[meeting.id] === undefined)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
  for (const meeting of fresh) {
    top += 1
    next[meeting.id] = top
    added = true
  }
  return { labels: next, added }
}

export interface ScopeListing {
  /** Escolhidas primeiro, depois as do período que ficaram de fora; da mais recente para a mais antiga. */
  main: ScopeCandidate[]
  /** Não escolhidas e anteriores ao período. */
  older: ScopeCandidate[]
}

/** Como a lista de Reuniões do escopo se organiza para marcar e desmarcar. */
export function listScopeMeetings(
  candidates: readonly ScopeCandidate[],
  scope: GroupScope,
  resolution: ScopeResolution,
  nowMs: number
): ScopeListing {
  const chosen = new Set(resolution.chosen.map((candidate) => candidate.id))
  const cutoff = scope.periodDays === null ? -Infinity : nowMs - scope.periodDays * DAY_MS
  const sorted = newestFirst(candidates)
  const picked = sorted.filter((candidate) => chosen.has(candidate.id))
  const rest = sorted.filter((candidate) => !chosen.has(candidate.id))
  return {
    main: [...picked, ...rest.filter((candidate) => startMs(candidate) >= cutoff)],
    older: rest.filter((candidate) => startMs(candidate) < cutoff)
  }
}
