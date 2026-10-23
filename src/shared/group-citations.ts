import type { ScopeRef } from './group-chat'
import { isWithinDuration, parseInstantText } from './instants'
import { formatInstant } from './timeline'

/** Reunião que uma citação pode apontar. */
export interface CitedMeeting {
  id: string
  name: string
  durationMs: number | null
}

export type GroupInlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }
  | {
      type: 'cite'
      meetingId: string
      /** Nome da Reunião citada. */
      name: string
      ms: number
      /** Instante formatado (`05:32`). */
      instant: string
    }

const TIME = String.raw`\d{1,3}:\d{2}(?::\d{2})?`
const LABEL_SEPARATOR = String.raw`[\s·:,\-–—]+`
const ITEM = String.raw`R\d{1,3}${LABEL_SEPARATOR}${TIME}`
const FOLLOWING = String.raw`(?:R\d{1,3}${LABEL_SEPARATOR})?${TIME}`
/** `**negrito**`, `` `código` `` ou `[R2 05:32]` (também `[R2 05:32, R3 10:11]` e `[R2 05:32, 07:10]`). */
const INLINE = new RegExp(
  String.raw`\*\*([^*\n]+)\*\*|` +
    '`([^`\n]+)`|' +
    String.raw`\[(${ITEM}(?:\s*[,;–—-]\s*${FOLLOWING})*)\]`,
  'gi'
)
const CITATION_ITEM = new RegExp(String.raw`(?:R(\d{1,3})${LABEL_SEPARATOR})?(${TIME})`, 'gi')

/** Reuniões que uma resposta pode citar, pelo rótulo (`R2` = 2). */
export function citedMeetings(scope: readonly ScopeRef[] | undefined): Map<number, CitedMeeting> {
  return new Map(
    (scope ?? []).map((ref) => [
      ref.label,
      { id: ref.id, name: ref.name, durationMs: ref.durationMs }
    ])
  )
}

function pushText(tokens: GroupInlineToken[], text: string): void {
  if (text === '') return
  const last = tokens[tokens.length - 1]
  if (last?.type === 'text') last.text += text
  else tokens.push({ type: 'text', text })
}

/**
 * Como `tokenizeInline`, para respostas sobre várias Reuniões: a citação é `[R2 05:32]` (rótulo da
 * Reunião + Instante). Rótulo desconhecido ou Instante fora da Reunião continua como texto.
 */
export function tokenizeGroupInline(
  text: string,
  meetings: ReadonlyMap<number, CitedMeeting>
): GroupInlineToken[] {
  const tokens: GroupInlineToken[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE)) {
    pushText(tokens, text.slice(cursor, match.index))
    cursor = match.index + match[0].length
    if (match[1] !== undefined) {
      tokens.push({ type: 'bold', text: match[1] })
      continue
    }
    if (match[2] !== undefined) {
      tokens.push({ type: 'code', text: match[2] })
      continue
    }
    let label: number | null = null
    let any = false
    const parts: GroupInlineToken[] = []
    for (const item of (match[3] as string).matchAll(CITATION_ITEM)) {
      if (item[1] !== undefined) label = Number(item[1])
      const ms = parseInstantText(item[2] as string)
      const meeting = label === null ? undefined : meetings.get(label)
      if (meeting && ms !== null && isWithinDuration(ms, meeting.durationMs)) {
        any = true
        parts.push({
          type: 'cite',
          meetingId: meeting.id,
          name: meeting.name,
          ms,
          instant: formatInstant(ms)
        })
      } else {
        parts.push({ type: 'text', text: `[${item[0]}]` })
      }
    }
    if (!any) {
      pushText(tokens, match[0])
      continue
    }
    parts.forEach((part, index) => {
      if (index > 0) pushText(tokens, ' ')
      if (part.type === 'text') pushText(tokens, part.text)
      else tokens.push(part)
    })
  }
  pushText(tokens, text.slice(cursor))
  return tokens
}
