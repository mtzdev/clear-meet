import type { ReactNode } from 'react'
import { InstantLink } from '@/components/meeting/instant-link'
import { CitationLink } from '@/components/meeting/citation-link'
import { tokenizeGroupInline, type CitedMeeting } from '@shared/group-citations'
import { tokenizeInline } from '@shared/instants'

interface InstantMode {
  /** Duração da Reunião: Instantes além dela não viram link. */
  durationMs: number | null
  onSeek: (ms: number) => void
}

interface CitationMode {
  /** Reuniões que a resposta pode citar, pelo rótulo (`[R2 05:32]`). */
  citations: ReadonlyMap<number, CitedMeeting>
}

type Mode = InstantMode | CitationMode
type RichTextProps = { text: string } & Mode

type Block =
  { type: 'paragraph'; lines: string[] } | { type: 'list'; ordered: boolean; items: string[] }

const BULLET = /^\s*(?:[-*•])\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^\s*#{1,6}\s+(.*)$/

function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim() === '') {
      blocks.push({ type: 'paragraph', lines: [] })
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    const item = bullet ?? numbered
    const last = blocks[blocks.length - 1]
    if (item) {
      const ordered = numbered !== null
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(item[1] as string)
      else blocks.push({ type: 'list', ordered, items: [item[1] as string] })
      continue
    }
    const content = (HEADING.exec(line)?.[1] ?? line).trim()
    if (last?.type === 'paragraph' && last.lines.length > 0) last.lines.push(content)
    else blocks.push({ type: 'paragraph', lines: [content] })
  }
  return blocks.filter((block) => block.type === 'list' || block.lines.length > 0)
}

function Inline(props: RichTextProps): ReactNode {
  const tokens =
    'citations' in props
      ? tokenizeGroupInline(props.text, props.citations)
      : tokenizeInline(props.text, props.durationMs)
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'bold':
        return <strong key={index}>{token.text}</strong>
      case 'code':
        return (
          <code key={index} className="bg-muted rounded px-1 py-0.5 text-[0.85em]">
            {token.text}
          </code>
        )
      case 'instant':
        return 'onSeek' in props ? (
          <InstantLink key={index} ms={token.ms} onSeek={props.onSeek} />
        ) : null
      case 'cite':
        return (
          <CitationLink
            key={index}
            meetingId={token.meetingId}
            name={token.name}
            ms={token.ms}
            instant={token.instant}
          />
        )
      default:
        return token.text
    }
  })
}

/**
 * Texto simples de uma resposta da IA: parágrafos, listas, negrito e código em linha. Os
 * Instantes citados como [mm:ss] viram links que levam o player até o trecho.
 */
export function RichText(props: RichTextProps) {
  const { text } = props
  const mode: Mode =
    'citations' in props
      ? { citations: props.citations }
      : { durationMs: props.durationMs, onSeek: props.onSeek }
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words">
      {toBlocks(text).map((block, index) => {
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List
              key={index}
              className={`space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} {...mode} />
                </li>
              ))}
            </List>
          )
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                <Inline text={line} {...mode} />
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
