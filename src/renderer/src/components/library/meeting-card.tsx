import { FileText, NotebookText, Sparkles } from 'lucide-react'
import { Snippet } from '@/components/library/snippet'
import { StatusBadge } from '@/components/library/status-badge'
import { Thumbnail } from '@/components/library/thumbnail'
import { SourceIcon } from '@/components/meeting/source-icon'
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format'
import { SOURCE_KIND_LABEL } from '@/lib/meeting-text'
import { meetingHref } from '@/lib/router'
import type { HitKind, LibraryEntry, SearchHit } from '@shared/library'
import { formatInstant } from '@shared/timeline'

const HIT_LABEL: Record<HitKind, string> = {
  name: 'Nome',
  utterance: 'Transcrição',
  note: 'Anotação',
  summary: 'Resumo'
}

function HitLink({ id, hit }: { id: string; hit: SearchHit }) {
  return (
    <a
      href={meetingHref(id, hit.offsetMs)}
      className="hover:bg-accent focus-visible:ring-ring/60 flex items-baseline gap-2 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-2"
    >
      <span className="text-muted-foreground w-28 shrink-0">
        {HIT_LABEL[hit.kind]}
        {hit.offsetMs !== null && (
          <span className="text-primary ml-1.5 font-medium tabular-nums">
            {formatInstant(hit.offsetMs)}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 leading-relaxed">
        {hit.speaker && (
          <span className="text-muted-foreground mr-1">
            <Snippet parts={hit.speaker} />:
          </span>
        )}
        <Snippet parts={hit.parts} />
      </span>
    </a>
  )
}

/** Uma Reunião na lista: o cartão todo abre a Reunião; cada trecho achado abre já no Instante. */
export function MeetingCard({ entry }: { entry: LibraryEntry }) {
  const { meeting, hits, hitCount } = entry
  const source =
    meeting.source.kind === 'window' && meeting.source.name
      ? meeting.source.name
      : SOURCE_KIND_LABEL[meeting.source.kind]
  const details = [
    formatDateTime(meeting.createdAt),
    meeting.durationMs !== null ? formatDuration(meeting.durationMs) : null,
    formatBytes(meeting.sizeBytes)
  ].filter((part): part is string => Boolean(part))
  const notes = meeting.noteCount === 1 ? 'Anotação' : 'Anotações'

  return (
    <li className="border-border hover:bg-accent/40 focus-within:ring-ring/60 relative rounded-xl border transition-colors focus-within:ring-2">
      <div className="flex gap-4 p-3">
        <Thumbnail item={meeting} className="w-36" />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
          <div className="flex items-start gap-2">
            <a
              href={meetingHref(meeting.id)}
              className="min-w-0 flex-1 truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
            >
              {meeting.name}
            </a>
            <StatusBadge item={meeting} />
          </div>
          <p className="text-muted-foreground truncate text-xs">{details.join(' · ')}</p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <SourceIcon kind={meeting.source.kind} className="size-3.5" />
              <span className="truncate">{source}</span>
            </span>
            <span
              className="flex items-center gap-1 tabular-nums"
              title={`${meeting.noteCount} ${notes}`}
            >
              <NotebookText className="size-3.5" aria-hidden />
              {meeting.noteCount}
              <span className="sr-only">{notes}</span>
            </span>
            {meeting.transcriptStatus === 'ready' && (
              <span className="flex items-center gap-1">
                <FileText className="size-3.5" aria-hidden />
                Transcrição
              </span>
            )}
            {meeting.summaryStatus === 'ready' && (
              <span className="flex items-center gap-1">
                <Sparkles className="size-3.5" aria-hidden />
                Resumo
              </span>
            )}
          </div>
        </div>
      </div>
      {hits.length > 0 && (
        <ul className="border-border relative z-10 space-y-0.5 border-t px-2 py-2">
          {hits.map((hit, index) => (
            <li key={index}>
              <HitLink id={meeting.id} hit={hit} />
            </li>
          ))}
          {hitCount > hits.length && (
            <li className="text-muted-foreground px-2 pt-1 text-xs">
              +{hitCount - hits.length} {hitCount - hits.length === 1 ? 'trecho' : 'trechos'} nesta
              Reunião
            </li>
          )}
        </ul>
      )}
    </li>
  )
}
