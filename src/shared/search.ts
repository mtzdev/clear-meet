import type { SnippetPart } from './library'
import { normalizeForSearch } from './transcript'

const MAX_TOKENS = 8
const WORD_CHARACTER = /[\p{L}\p{N}]/u

/** Palavras da busca, sem acentos e em minúsculas (como o índice as guarda), sem repetir. */
export function searchTokens(text: string): string[] {
  const words = normalizeForSearch(text).match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words)].slice(0, MAX_TOKENS)
}

/**
 * Consulta FTS5: todas as palavras precisam aparecer no mesmo trecho e cada uma vale como
 * prefixo, para a busca responder enquanto o usuário digita. Aspas fecham o termo (um "or"
 * digitado vira palavra, não operador). Sem palavras = `null`.
 */
export function buildFtsQuery(text: string): string | null {
  const tokens = searchTokens(text)
  return tokens.length === 0 ? null : tokens.map((token) => `"${token}"*`).join(' ')
}

interface Normalized {
  haystack: string
  /** Para cada caractere de `haystack`, o índice do caractere de origem em `text`. */
  origin: number[]
}

function normalizeWithOrigin(text: string): Normalized {
  let haystack = ''
  const origin: number[] = []
  for (let i = 0; i < text.length; i++) {
    const normalized = normalizeForSearch(text.charAt(i))
    for (let k = 0; k < normalized.length; k++) origin.push(i)
    haystack += normalized
  }
  return { haystack, origin }
}

/** Trechos de `text` onde alguma palavra da busca começa uma palavra, como `[início, fim)`. */
export function matchRanges(text: string, tokens: readonly string[]): [number, number][] {
  const { haystack, origin } = normalizeWithOrigin(text)
  const ranges: [number, number][] = []
  for (const token of tokens) {
    if (token === '') continue
    for (let at = haystack.indexOf(token); at >= 0; at = haystack.indexOf(token, at + 1)) {
      if (at > 0 && WORD_CHARACTER.test(haystack.charAt(at - 1))) continue
      const start = origin[at] as number
      const end = (origin[at + token.length - 1] as number) + 1
      ranges.push([start, end])
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

const CONTEXT_BEFORE = 40

/**
 * Trecho de `text` de até `maxLength` caracteres em volta da primeira ocorrência, com as
 * ocorrências marcadas. Sem ocorrência, é o começo do texto.
 */
export function makeSnippet(
  text: string,
  tokens: readonly string[],
  maxLength = 160
): SnippetPart[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  const ranges = matchRanges(flat, tokens)
  const first = ranges[0]
  let start = 0
  if (first && first[0] > CONTEXT_BEFORE) {
    start = first[0] - CONTEXT_BEFORE
    const space = flat.indexOf(' ', start)
    if (space >= 0 && space < first[0]) start = space + 1
  }
  const end = Math.min(flat.length, start + maxLength)

  const parts: SnippetPart[] = []
  if (start > 0) parts.push({ text: '…', match: false })
  let cursor = start
  for (const [from, to] of ranges) {
    if (to <= cursor || from >= end) continue
    const matchStart = Math.max(from, cursor)
    const matchEnd = Math.min(to, end)
    if (matchStart > cursor) parts.push({ text: flat.slice(cursor, matchStart), match: false })
    parts.push({ text: flat.slice(matchStart, matchEnd), match: true })
    cursor = matchEnd
  }
  if (cursor < end) parts.push({ text: flat.slice(cursor, end), match: false })
  if (end < flat.length) parts.push({ text: '…', match: false })
  return parts
}
