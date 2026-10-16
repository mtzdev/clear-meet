import { formatInstant } from './timeline'

/** Folga ao validar um Instante citado pela IA contra a duração da Reunião. */
const DURATION_TOLERANCE_MS = 5000

/** "12:34" (mm:ss) ou "1:02:03" (h:mm:ss) em milissegundos; qualquer outra coisa, `null`. */
export function parseInstantText(raw: string): number | null {
  const match = /^\s*\[?(\d{1,3}):(\d{2})(?::(\d{2}))?\]?\s*$/.exec(raw)
  if (!match) return null
  const first = Number(match[1])
  const second = Number(match[2])
  const third = match[3] === undefined ? null : Number(match[3])
  if (second > 59 || (third !== null && third > 59)) return null
  const seconds = third === null ? first * 60 + second : first * 3600 + second * 60 + third
  return seconds * 1000
}

/** O Instante cabe na Reunião? Sem duração conhecida, vale qualquer um. */
export function isWithinDuration(ms: number, durationMs: number | null): boolean {
  return durationMs === null || durationMs <= 0 || ms <= durationMs + DURATION_TOLERANCE_MS
}

/** Instantes citados (texto da IA) em ms: sem repetidos, em ordem, sem os inválidos ou fora da Reunião. */
export function normalizeCitations(raw: unknown, durationMs: number | null): number[] {
  if (!Array.isArray(raw)) return []
  const found = new Set<number>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const ms = parseInstantText(item)
    if (ms !== null && isWithinDuration(ms, durationMs)) found.add(ms)
  }
  return [...found].sort((a, b) => a - b)
}

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }
  | { type: 'instant'; ms: number; label: string }

const TIME = String.raw`\d{1,3}:\d{2}(?::\d{2})?`
/** `**negrito**`, `` `código` `` ou `[mm:ss]` (também `[mm:ss, mm:ss]` e `[mm:ss-mm:ss]`). */
const INLINE = new RegExp(
  String.raw`\*\*([^*\n]+)\*\*|` +
    '`([^`\n]+)`|' +
    String.raw`\[(${TIME}(?:\s*[,;–—-]\s*${TIME})*)\]`,
  'g'
)

function pushText(tokens: InlineToken[], text: string): void {
  if (text === '') return
  const last = tokens[tokens.length - 1]
  if (last?.type === 'text') last.text += text
  else tokens.push({ type: 'text', text })
}

/**
 * Quebra um trecho de texto da IA em partes: texto, negrito, código e Instantes citados
 * (`[mm:ss]`). Um Instante inválido ou fora da Reunião continua como texto simples.
 */
export function tokenizeInline(text: string, durationMs: number | null): InlineToken[] {
  const tokens: InlineToken[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE)) {
    pushText(tokens, text.slice(cursor, match.index))
    cursor = match.index + match[0].length
    if (match[1] !== undefined) {
      tokens.push({ type: 'bold', text: match[1] })
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'code', text: match[2] })
    } else {
      const parts = (match[3] as string).split(/\s*[,;–—-]\s*/)
      const valid = parts.map((part) => {
        const ms = parseInstantText(part)
        return ms !== null && isWithinDuration(ms, durationMs) ? ms : null
      })
      if (valid.every((ms) => ms === null)) {
        pushText(tokens, match[0])
        continue
      }
      parts.forEach((part, index) => {
        const ms = valid[index] ?? null
        if (index > 0) pushText(tokens, ' ')
        if (ms === null) pushText(tokens, `[${part}]`)
        else tokens.push({ type: 'instant', ms, label: formatInstant(ms) })
      })
    }
  }
  pushText(tokens, text.slice(cursor))
  return tokens
}

/** Instantes (ms) citados como `[mm:ss]` num texto, sem repetir, na ordem em que aparecem. */
export function extractInstants(text: string, durationMs: number | null): number[] {
  const found: number[] = []
  for (const token of tokenizeInline(text, durationMs)) {
    if (token.type === 'instant' && !found.includes(token.ms)) found.push(token.ms)
  }
  return found
}
