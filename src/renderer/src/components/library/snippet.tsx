import type { SnippetPart } from '@shared/library'

/** Trecho de texto com o termo buscado marcado. */
export function Snippet({ parts }: { parts: SnippetPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index} className="bg-primary/15 text-foreground rounded-sm px-0.5 font-medium">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </>
  )
}
