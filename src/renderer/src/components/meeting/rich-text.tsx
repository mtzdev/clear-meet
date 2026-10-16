import type { ReactNode } from 'react'
import { InstantLink } from '@/components/meeting/instant-link'
import { tokenizeInline } from '@shared/instants'

interface RichTextProps {
  text: string
  /** Duração da Reunião: Instantes além dela não viram link. */
  durationMs: number | null
  onSeek: (ms: number) => void
}

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

function Inline({ text, durationMs, onSeek }: RichTextProps): ReactNode {
  return tokenizeInline(text, durationMs).map((token, index) => {
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
        return <InstantLink key={index} ms={token.ms} onSeek={onSeek} />
      default:
        return token.text
    }
  })
}

/**
 * Texto simples de uma resposta da IA: parágrafos, listas, negrito e código em linha. Os
 * Instantes citados como [mm:ss] viram links que levam o player até o trecho.
 */
export function RichText({ text, durationMs, onSeek }: RichTextProps) {
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
                  <Inline text={item} durationMs={durationMs} onSeek={onSeek} />
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
                <Inline text={line} durationMs={durationMs} onSeek={onSeek} />
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
