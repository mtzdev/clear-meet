import { normalizeCitations } from '@shared/instants'
import type { SummaryAction, SummaryContent, SummaryItem } from '@shared/summary'

/** A resposta da IA não é um Resumo utilizável (JSON malformado ou sem conteúdo). */
export class SummaryParseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function items(value: unknown, durationMs: number | null): SummaryItem[] {
  if (!Array.isArray(value)) return []
  const result: SummaryItem[] = []
  for (const entry of value) {
    // Aceita também um item que veio só como texto.
    const text = clean(isRecord(entry) ? entry.text : entry)
    if (text === '') continue
    result.push({
      text,
      at: normalizeCitations(isRecord(entry) ? entry.citations : [], durationMs)
    })
  }
  return result
}

function actions(value: unknown, durationMs: number | null): SummaryAction[] {
  if (!Array.isArray(value)) return []
  const result: SummaryAction[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const task = clean(entry.task)
    if (task === '') continue
    result.push({
      owner: clean(entry.owner) || null,
      task,
      due: clean(entry.due) || null,
      at: normalizeCitations(entry.citations, durationMs)
    })
  }
  return result
}

/** O JSON dentro de uma cerca de código (```json), que alguns modelos usam mesmo sem ser pedido. */
function unfence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  return (fenced ? (fenced[1] as string) : text).trim()
}

/**
 * Valida a resposta da IA e a transforma em Resumo. Itens inválidos são descartados; Instantes
 * mal escritos ou além da duração da Reunião são removidos do item (o texto fica).
 */
export function parseSummaryResponse(text: string, durationMs: number | null): SummaryContent {
  let raw: unknown
  try {
    raw = JSON.parse(unfence(text))
  } catch {
    throw new SummaryParseError('JSON malformado')
  }
  if (!isRecord(raw)) throw new SummaryParseError('a resposta não é um objeto')
  const content: SummaryContent = {
    overview: clean(raw.overview),
    keyPoints: items(raw.keyPoints, durationMs),
    decisions: items(raw.decisions, durationMs),
    actions: actions(raw.actions, durationMs)
  }
  const empty =
    content.overview === '' &&
    content.keyPoints.length === 0 &&
    content.decisions.length === 0 &&
    content.actions.length === 0
  if (empty) throw new SummaryParseError('resposta sem conteúdo')
  return content
}
