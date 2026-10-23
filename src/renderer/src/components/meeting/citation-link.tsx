import { meetingHref } from '@/lib/router'

interface CitationLinkProps {
  meetingId: string
  name: string
  ms: number
  /** Instante formatado (`05:32`). */
  instant: string
}

/** Citação de uma Reunião do grupo: abre a Reunião já no Instante citado. */
export function CitationLink({ meetingId, name, ms, instant }: CitationLinkProps) {
  return (
    <a
      href={meetingHref(meetingId, ms)}
      title={`Abrir ${name} em ${instant}`}
      aria-label={`Abrir ${name} em ${instant}`}
      className="text-primary focus-visible:ring-ring/60 mx-0.5 rounded text-xs font-medium outline-none hover:underline focus-visible:ring-2"
    >
      <span className="inline-block max-w-44 truncate align-bottom">{name}</span>
      <span className="tabular-nums"> · {instant}</span>
    </a>
  )
}
