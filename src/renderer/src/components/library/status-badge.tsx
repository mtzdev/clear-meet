import { CircleDot, LoaderCircle, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { listStatus, type MeetingListItem } from '@shared/library'

type StatusInput = Pick<
  MeetingListItem,
  'status' | 'live' | 'transcriptStatus' | 'summaryStatus' | 'compactionStatus'
>

/** Situação da Reunião na lista: gravando, processando, transcrevendo, resumindo, pronta... */
export function StatusBadge({
  item,
  percent = null,
  className
}: {
  item: StatusInput
  /** Andamento da Compactação (0 a 100), quando se sabe. */
  percent?: number | null
  className?: string
}) {
  const status = listStatus(item)
  switch (status.kind) {
    case 'recording':
      return (
        <Badge className={cn('bg-record text-white', className)}>
          <CircleDot aria-hidden />
          {status.label}
        </Badge>
      )
    case 'interrupted':
    case 'warning':
      return (
        <Badge variant="outline" className={cn('text-warning', className)}>
          <TriangleAlert aria-hidden />
          {status.label}
        </Badge>
      )
    case 'processing':
    case 'transcribing':
    case 'summarizing':
    case 'compacting':
      return (
        <Badge variant="outline" className={className}>
          <LoaderCircle className="animate-spin" aria-hidden />
          {status.label}
          {status.kind === 'compacting' && percent !== null && (
            <span className="tabular-nums">{percent}%</span>
          )}
        </Badge>
      )
    case 'ready':
      return (
        <Badge variant="secondary" className={cn('text-muted-foreground', className)}>
          {status.label}
        </Badge>
      )
  }
}
