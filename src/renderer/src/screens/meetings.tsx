import { Library, LoaderCircle, NotebookText, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { Screen } from '@/components/layout/screen'
import { SourceIcon } from '@/components/meeting/source-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatDuration } from '@/lib/format'
import { useIpcQuery } from '@/lib/ipc'
import { SOURCE_KIND_LABEL, statusLabel } from '@/lib/meeting-text'
import { meetingHref } from '@/lib/router'
import type { MeetingListItem } from '@shared/library'
import type { SummaryStatus } from '@shared/summary'
import type { TranscriptStatus } from '@shared/transcript'

function MeetingRow({
  item,
  transcript,
  summary
}: {
  item: MeetingListItem
  transcript: TranscriptStatus
  summary: SummaryStatus
}) {
  const status = statusLabel(item.status, item.live)
  const details = [
    formatDateTime(item.createdAt),
    item.durationMs !== null ? formatDuration(item.durationMs) : null,
    item.source.kind === 'window' && item.source.name
      ? item.source.name
      : SOURCE_KIND_LABEL[item.source.kind]
  ].filter((part): part is string => Boolean(part))

  return (
    <li>
      <a
        href={meetingHref(item.id)}
        className="border-border hover:bg-accent/50 focus-visible:ring-ring/60 flex items-center gap-4 rounded-xl border px-4 py-3 transition-colors outline-none focus-visible:ring-2"
      >
        <div className="bg-accent text-accent-foreground grid size-10 shrink-0 place-items-center rounded-lg">
          <SourceIcon kind={item.source.kind} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="text-muted-foreground truncate text-xs">{details.join(' · ')}</p>
        </div>
        {status && (
          <Badge variant={item.live ? 'default' : 'outline'} className="shrink-0">
            {status}
          </Badge>
        )}
        {transcript === 'running' && (
          <Badge variant="outline" className="shrink-0">
            <LoaderCircle className="animate-spin" aria-hidden />
            Transcrevendo…
          </Badge>
        )}
        {summary === 'running' && (
          <Badge variant="outline" className="shrink-0">
            <LoaderCircle className="animate-spin" aria-hidden />
            Resumindo…
          </Badge>
        )}
        {transcript === 'error' && (
          <Badge variant="outline" className="text-warning shrink-0">
            Transcrição interrompida
          </Badge>
        )}
        <span
          className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs tabular-nums"
          title={`${item.noteCount} ${item.noteCount === 1 ? 'Anotação' : 'Anotações'}`}
        >
          <NotebookText className="size-3.5" aria-hidden />
          {item.noteCount}
        </span>
      </a>
    </li>
  )
}

export function MeetingsScreen() {
  const query = useIpcQuery('meetings:list')
  // Estados de Transcrição que mudaram depois de a lista ser lida.
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptStatus>>({})
  const [summaries, setSummaries] = useState<Record<string, SummaryStatus>>({})
  useEffect(
    () =>
      window.api.on('transcript:changed', (event) => {
        setTranscripts((current) => ({ ...current, [event.meetingId]: event.view.status }))
      }),
    []
  )
  useEffect(
    () =>
      window.api.on('summary:changed', (event) => {
        setSummaries((current) => ({ ...current, [event.meetingId]: event.view.status }))
      }),
    []
  )

  return (
    <Screen title="Reuniões">
      {query.status === 'loading' && (
        <p className="text-muted-foreground px-8 py-6 text-sm">Carregando as Reuniões…</p>
      )}
      {query.status === 'error' && (
        <EmptyState
          icon={TriangleAlert}
          title="Não foi possível listar as Reuniões"
          description={query.error}
          action={
            <Button variant="outline" onClick={query.reload}>
              Tentar de novo
            </Button>
          }
        />
      )}
      {query.status === 'ready' && query.data.items.length === 0 && (
        <EmptyState
          icon={Library}
          title="Nenhuma Reunião ainda"
          description="As Reuniões gravadas aparecem aqui, da mais recente para a mais antiga."
          action={
            <Button asChild variant="outline">
              <a href="#/record">Ir para Gravar</a>
            </Button>
          }
        />
      )}
      {query.status === 'ready' && query.data.items.length > 0 && (
        <div className="mx-auto max-w-4xl space-y-4 px-8 py-6">
          <ul className="space-y-2">
            {query.data.items.map((item) => (
              <MeetingRow
                key={item.id}
                item={item}
                transcript={transcripts[item.id] ?? item.transcriptStatus}
                summary={summaries[item.id] ?? item.summaryStatus}
              />
            ))}
          </ul>
          {query.data.skipped > 0 && (
            <p className="text-muted-foreground text-xs">
              {query.data.skipped === 1
                ? '1 pasta foi ignorada porque o meeting.json não pôde ser lido.'
                : `${query.data.skipped} pastas foram ignoradas porque o meeting.json não pôde ser lido.`}{' '}
              Nada foi alterado nelas.
            </p>
          )}
        </div>
      )}
    </Screen>
  )
}
