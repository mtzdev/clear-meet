import { isAiProvider, type AiProvider } from './ai'
import type { ParseResult } from './meeting'
import { formatInstant } from './timeline'

export const SUMMARY_FILE = 'summary.json'
export const SUMMARY_SCHEMA_VERSION = 1

/**
 * Situação do Resumo no `meeting.json`:
 * - `none`: nunca gerado (ou cancelado);
 * - `running`: em andamento no main (se o app fechou no meio, ao reabrir vira `error`);
 * - `ready`: `summary.json` pronto;
 * - `error`: falhou ou foi interrompido; dá para tentar de novo.
 */
export const SUMMARY_STATUSES = ['none', 'running', 'ready', 'error'] as const
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number]

export interface SummaryMeta {
  status: SummaryStatus
  error?: string
  /** Quem gerou o Resumo pronto. */
  provider?: AiProvider
  model?: string
  updatedAt: string
}

/** Ponto do Resumo com os Instantes (ms) da Transcrição que o sustentam. */
export interface SummaryItem {
  text: string
  at: number[]
}

/** "Quem faz o quê": `owner` e `due` são `null` quando a Reunião não disse. */
export interface SummaryAction {
  owner: string | null
  task: string
  due: string | null
  at: number[]
}

export interface SummaryContent {
  overview: string
  keyPoints: SummaryItem[]
  decisions: SummaryItem[]
  actions: SummaryAction[]
}

export interface SummaryFile extends SummaryContent {
  schemaVersion: typeof SUMMARY_SCHEMA_VERSION
  provider: AiProvider
  model: string
  createdAt: string
}

/** O que a UI vê do Resumo de uma Reunião. */
export interface SummaryView {
  status: SummaryStatus
  error: string | null
  provider: AiProvider | null
  model: string | null
  updatedAt: string | null
}

export const NO_SUMMARY: SummaryView = {
  status: 'none',
  error: null,
  provider: null,
  model: null,
  updatedAt: null
}

export function makeSummaryView(meta: SummaryMeta | undefined): SummaryView {
  if (!meta) return NO_SUMMARY
  return {
    status: meta.status,
    error: meta.error ?? null,
    provider: meta.provider ?? null,
    model: meta.model ?? null,
    updatedAt: meta.updatedAt
  }
}

export interface SummaryChangedEvent {
  meetingId: string
  folder: string
  view: SummaryView
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/** Lê o bloco `summary` do `meeting.json`; formato inválido = `undefined` (como se não existisse). */
export function parseSummaryMeta(raw: unknown): SummaryMeta | undefined {
  if (!isRecord(raw)) return undefined
  if (
    typeof raw.status !== 'string' ||
    !(SUMMARY_STATUSES as readonly string[]).includes(raw.status) ||
    !isIsoDate(raw.updatedAt)
  ) {
    return undefined
  }
  const meta: SummaryMeta = { status: raw.status as SummaryStatus, updatedAt: raw.updatedAt }
  if (typeof raw.error === 'string' && raw.error !== '') meta.error = raw.error
  if (isAiProvider(raw.provider)) meta.provider = raw.provider
  if (typeof raw.model === 'string' && raw.model !== '') meta.model = raw.model
  return meta
}

function parseInstants(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  return value.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0)
    ? (value as number[])
    : null
}

function parseItems(value: unknown): SummaryItem[] | null {
  if (!Array.isArray(value)) return null
  const items: SummaryItem[] = []
  for (const item of value) {
    const at = isRecord(item) ? parseInstants(item.at) : null
    if (!isRecord(item) || typeof item.text !== 'string' || !at) return null
    items.push({ text: item.text, at })
  }
  return items
}

function parseActions(value: unknown): SummaryAction[] | null {
  if (!Array.isArray(value)) return null
  const actions: SummaryAction[] = []
  for (const item of value) {
    const at = isRecord(item) ? parseInstants(item.at) : null
    if (
      !isRecord(item) ||
      typeof item.task !== 'string' ||
      (item.owner !== null && typeof item.owner !== 'string') ||
      (item.due !== null && typeof item.due !== 'string') ||
      !at
    ) {
      return null
    }
    actions.push({ owner: item.owner, task: item.task, due: item.due, at })
  }
  return actions
}

export function parseSummary(raw: unknown): ParseResult<SummaryFile> {
  if (!isRecord(raw)) return { ok: false, error: 'summary.json não é um objeto' }
  if (raw.schemaVersion !== SUMMARY_SCHEMA_VERSION) {
    return { ok: false, error: 'versão do summary.json não suportada' }
  }
  if (!isAiProvider(raw.provider)) return { ok: false, error: 'provider inválido' }
  if (typeof raw.model !== 'string') return { ok: false, error: 'model inválido' }
  if (!isIsoDate(raw.createdAt)) return { ok: false, error: 'createdAt inválido' }
  if (typeof raw.overview !== 'string') return { ok: false, error: 'overview inválido' }
  const keyPoints = parseItems(raw.keyPoints)
  if (!keyPoints) return { ok: false, error: 'keyPoints inválido' }
  const decisions = parseItems(raw.decisions)
  if (!decisions) return { ok: false, error: 'decisions inválido' }
  const actions = parseActions(raw.actions)
  if (!actions) return { ok: false, error: 'actions inválido' }
  return {
    ok: true,
    value: {
      schemaVersion: SUMMARY_SCHEMA_VERSION,
      provider: raw.provider,
      model: raw.model,
      createdAt: raw.createdAt,
      overview: raw.overview,
      keyPoints,
      decisions,
      actions
    }
  }
}

export function parseSummaryText(text: string): ParseResult<SummaryFile> {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { ok: false, error: 'summary.json não é um JSON válido' }
  }
  return parseSummary(raw)
}

export function serializeSummary(summary: SummaryFile): string {
  return `${JSON.stringify(summary, null, 2)}\n`
}

function instantsText(at: readonly number[]): string {
  return at.length === 0 ? '' : ` ${at.map((ms) => `[${formatInstant(ms)}]`).join(' ')}`
}

function actionText(action: SummaryAction, markdown: boolean): string {
  const owner = action.owner ?? 'Sem responsável definido'
  const who = markdown ? `**${owner}**` : owner
  const due = action.due ? ` (prazo: ${action.due})` : ''
  return `${who}: ${action.task}${due}${instantsText(action.at)}`
}

/** O Resumo como texto para copiar; `markdown` liga títulos e negrito. */
export function summaryToText(
  summary: SummaryContent,
  name: string,
  options: { markdown: boolean }
): string {
  const { markdown } = options
  const title = (text: string): string => (markdown ? `## ${text}` : text.toUpperCase())
  const lines: string[] = [markdown ? `# Resumo: ${name}` : `Resumo: ${name}`, '']
  lines.push(title('Visão geral'), summary.overview, '')
  const list = (heading: string, items: string[], empty: string): void => {
    lines.push(title(heading))
    if (items.length === 0) lines.push(empty)
    else lines.push(...items.map((item) => `- ${item}`))
    lines.push('')
  }
  list(
    'Pontos principais',
    summary.keyPoints.map((item) => `${item.text}${instantsText(item.at)}`),
    'Nenhum.'
  )
  list(
    'Decisões',
    summary.decisions.map((item) => `${item.text}${instantsText(item.at)}`),
    'Nenhuma decisão registrada.'
  )
  list(
    'Quem faz o quê',
    summary.actions.map((action) => actionText(action, markdown)),
    'Nenhuma ação registrada.'
  )
  return `${lines.join('\n').trimEnd()}\n`
}
