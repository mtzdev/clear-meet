import type { ContextLevel, MeetingRelevance, ScopeRef } from '@shared/group-chat'
import type { MeetingNote } from '@shared/meeting'
import type { SummaryFile } from '@shared/summary'
import { formatInstant } from '@shared/timeline'
import { normalizeForSearch, type TranscriptFile } from '@shared/transcript'
import { NOTES_HEADING, noteLines, oneLine, utteranceLine } from '../text/format'

/**
 * Tamanho máximo do contexto (Resumos, Transcrições e Anotações) de uma pergunta ao grupo, em
 * caracteres. A Transcrição de uma hora de Reunião tem cerca de 55 mil caracteres (média real de
 * ~31 mil por Reunião), então cabem umas 7 Reuniões médias inteiras e as 5 do padrão quase
 * sempre. Com 3,4 caracteres por token em português são ~65 mil tokens: cabe no contexto de 131
 * mil do modelo padrão da Groq com folga para histórico, instruções e a resposta; pedidos
 * grandes demais para o plano da Groq caem sozinhos no Gemini.
 */
export const CONTEXT_BUDGET_CHARS = 220_000
export const CHARS_PER_TOKEN = 3.4

/** Teto do trecho de uma Reunião cuja Transcrição não coube. */
const EXCERPT_MAX_CHARS = 8000
/** Menor trecho que vale incluir. */
const EXCERPT_MIN_CHARS = 300
/** Sem Resumo e sem trecho relevante, a abertura da Transcrição dá ao menos o assunto. */
const OPENING_CHARS = 1500
/** Falas vizinhas que acompanham cada trecho relevante. */
const EXCERPT_NEIGHBORS = 1
const MAX_QUERY_WORDS = 10

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

export interface ContextMeeting {
  id: string
  /** Rótulo numérico da Reunião na Conversa (`R2` = 2). */
  label: number
  name: string
  createdAt: string
  durationMs: number | null
  transcript: TranscriptFile
  summary: SummaryFile | null
  notes: readonly MeetingNote[]
}

export interface BuiltContext {
  text: string
  refs: ScopeRef[]
  chars: number
  estimatedTokens: number
}

const STOPWORDS = new Set(
  (
    'de da do das dos em na no nas nos para por com sem que qual quais quem como quando onde foi ' +
    'foram ser era sao uma um uns umas ele ela eles elas isso isto esse essa esses essas este esta ' +
    'estes estas aquele aquela meu minha seu sua nosso nossa muito mais menos entre sobre tem ter ' +
    'tinha tinham fica ficou ficaram ainda nao sim mas ou ao aos as os se foi vai vao sera todas ' +
    'todos toda todo cada algum alguma alguns algumas reuniao reunioes grupo conversa falou ' +
    'disse falaram the and for with what which who when where about from that this are was were'
  ).split(' ')
)

/**
 * Consulta FTS5 (qualquer palavra, em prefixo) para achar os trechos que mais se parecem com a
 * pergunta. Tira palavras comuns; sem nenhuma palavra útil devolve `null`.
 */
export function relevanceQuery(question: string): string | null {
  const words = normalizeForSearch(question).match(/[\p{L}\p{N}]+/gu) ?? []
  const useful = words.filter(
    (word) => !STOPWORDS.has(word) && (word.length >= 3 || (/^\d+$/.test(word) && word.length >= 2))
  )
  const unique = [...new Set(useful)].slice(0, MAX_QUERY_WORDS)
  return unique.length === 0 ? null : unique.map((word) => `"${word}"*`).join(' OR ')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateTimeText(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function headerText(meeting: ContextMeeting): string {
  const duration = meeting.durationMs ?? meeting.transcript.durationMs
  const parts = [`R${meeting.label}`, oneLine(meeting.name), dateTimeText(meeting.createdAt)]
  return `=== ${parts.filter((part) => part !== '').join(' · ')}${
    duration ? ` (duração ${formatInstant(duration)})` : ''
  } ===`
}

function cite(meeting: ContextMeeting, at: readonly number[]): string {
  const first = at[0]
  return first === undefined ? '' : ` [R${meeting.label} ${formatInstant(first)}]`
}

function summaryLines(meeting: ContextMeeting, summary: SummaryFile): string[] {
  const lines = ['RESUMO:', oneLine(summary.overview)]
  const section = (title: string, items: readonly { text: string; at: number[] }[]): void => {
    if (items.length === 0) return
    lines.push(`${title}:`)
    for (const item of items) lines.push(`- ${oneLine(item.text)}${cite(meeting, item.at)}`)
  }
  section('Pontos principais', summary.keyPoints)
  section('Decisões', summary.decisions)
  if (summary.actions.length > 0) {
    lines.push('Quem faz o quê:')
    for (const action of summary.actions) {
      const owner = action.owner ? `${oneLine(action.owner)}: ` : ''
      const due = action.due ? ` (prazo: ${oneLine(action.due)})` : ''
      lines.push(`- ${owner}${oneLine(action.task)}${due}${cite(meeting, action.at)}`)
    }
  }
  return lines
}

/** Cabeçalho, Resumo e Anotações: o mínimo que toda Reunião do escopo leva. */
function baseText(meeting: ContextMeeting): string {
  const lines = [headerText(meeting)]
  if (meeting.summary) lines.push(...summaryLines(meeting, meeting.summary))
  const notes = noteLines(meeting.notes)
  if (notes.length > 0) lines.push(NOTES_HEADING, ...notes)
  return lines.join('\n')
}

function transcriptText(meeting: ContextMeeting): string {
  const { transcript } = meeting
  return [
    'TRANSCRIÇÃO:',
    ...transcript.utterances.map((utterance) => utteranceLine(transcript, utterance))
  ].join('\n')
}

function cutAtLine(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, Math.max(0, maxChars - 4))
  const newline = cut.lastIndexOf('\n')
  return `${newline > 0 ? cut.slice(0, newline) : cut}\n[…]`
}

type RankedMeeting = ContextMeeting & { relevance?: MeetingRelevance }

/** Trechos da Transcrição em volta dos Instantes que mais casam com a pergunta. */
function excerptBlock(meeting: RankedMeeting, maxChars: number): string | null {
  const { utterances } = meeting.transcript
  if (utterances.length === 0 || maxChars < EXCERPT_MIN_CHARS) return null
  const lines = utterances.map((utterance) => utteranceLine(meeting.transcript, utterance))
  const title = 'TRECHOS MAIS RELEVANTES DA TRANSCRIÇÃO (a Transcrição completa não coube):'
  const room = maxChars - title.length - 1
  const chosen = new Set<number>()
  let used = 0
  const take = (index: number): boolean => {
    if (chosen.has(index)) return true
    const line = lines[index] as string
    if (used + line.length + 1 > room) return false
    chosen.add(index)
    used += line.length + 1
    return true
  }
  for (const offset of meeting.relevance?.offsets ?? []) {
    const center = utterances.findIndex((utterance) => utterance.startMs >= offset)
    if (center < 0) continue
    let fits = take(center)
    for (let step = 1; fits && step <= EXCERPT_NEIGHBORS; step++) {
      if (center - step >= 0) fits = take(center - step)
      if (fits && center + step < lines.length) fits = take(center + step)
    }
    if (!fits) break
  }
  const hasHits = chosen.size > 0
  if (!hasHits) {
    if (meeting.summary) return null
    for (let index = 0; index < lines.length && used < Math.min(room, OPENING_CHARS); index++) {
      if (!take(index)) break
    }
  }
  if (chosen.size === 0) return null
  const ordered = [...chosen].sort((a, b) => a - b)
  const body: string[] = []
  ordered.forEach((index, position) => {
    if (position > 0 && index !== (ordered[position - 1] as number) + 1) body.push('[…]')
    body.push(lines[index] as string)
  })
  return [hasHits ? title : title.replace('MAIS RELEVANTES', 'INICIAIS'), ...body].join('\n')
}

/**
 * Monta o contexto de uma pergunta ao grupo dentro do orçamento. Toda Reunião leva cabeçalho,
 * Resumo e Anotações; a Transcrição inteira vai primeiro para as mais relevantes para a pergunta
 * (as mais recentes, sem relevância conhecida) enquanto couber; com o que sobra, as demais levam
 * os trechos que mais casam com a pergunta. As Reuniões saem em ordem cronológica.
 */
export function buildGroupContext(
  meetings: readonly ContextMeeting[],
  relevance: ReadonlyMap<string, MeetingRelevance>,
  budgetChars = CONTEXT_BUDGET_CHARS
): BuiltContext {
  const SEPARATOR = '\n\n'
  const items: RankedMeeting[] = meetings.map((meeting) => {
    const found = relevance.get(meeting.id)
    return found ? { ...meeting, relevance: found } : meeting
  })
  const share = Math.floor(budgetChars / Math.max(1, items.length))
  const bases = new Map(items.map((item) => [item.id, cutAtLine(baseText(item), share)]))
  let used = [...bases.values()].reduce((sum, text) => sum + text.length, 0)
  used += SEPARATOR.length * Math.max(0, items.length - 1)

  const ranked = [...items].sort(
    (a, b) =>
      (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt)
  )
  const levels = new Map<string, ContextLevel>(
    items.map((item) => [item.id, item.summary ? 'summary' : 'header'])
  )
  const extras = new Map<string, string>()

  for (const item of ranked) {
    const full = transcriptText(item)
    if (item.transcript.utterances.length === 0) continue
    const cost = full.length + 1
    if (used + cost > budgetChars) continue
    extras.set(item.id, full)
    levels.set(item.id, 'full')
    used += cost
  }
  for (const item of ranked) {
    if (levels.get(item.id) === 'full') continue
    const block = excerptBlock(item, Math.min(EXCERPT_MAX_CHARS, budgetChars - used - 1))
    if (!block) continue
    extras.set(item.id, block)
    levels.set(item.id, 'excerpts')
    used += block.length + 1
  }

  const chronological = [...items].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.label - b.label
  )
  const text = chronological
    .map((item) => {
      const extra = extras.get(item.id)
      return extra ? `${bases.get(item.id) as string}\n${extra}` : (bases.get(item.id) as string)
    })
    .join(SEPARATOR)
  const refs: ScopeRef[] = chronological.map((item) => ({
    id: item.id,
    label: item.label,
    name: item.name,
    createdAt: item.createdAt,
    durationMs: item.durationMs,
    level: levels.get(item.id) as ContextLevel
  }))
  return { text, refs, chars: text.length, estimatedTokens: estimateTokens(text.length) }
}
