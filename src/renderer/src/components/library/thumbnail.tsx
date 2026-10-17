import { Video } from 'lucide-react'
import { useState } from 'react'
import { SourceIcon } from '@/components/meeting/source-icon'
import { cn } from '@/lib/utils'
import type { MeetingListItem } from '@shared/library'

/** Miniatura da Reunião; sem Vídeo ou enquanto não existe, um ícone no lugar. */
export function Thumbnail({
  item,
  className
}: {
  item: Pick<MeetingListItem, 'thumbnail' | 'hasVideo' | 'source'>
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = item.thumbnail !== null && failed !== item.thumbnail ? item.thumbnail : null
  return (
    <div
      className={cn(
        'bg-muted text-muted-foreground relative grid aspect-video shrink-0 place-items-center overflow-hidden rounded-lg',
        className
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailed(src)}
        />
      ) : item.hasVideo ? (
        <Video className="size-5" aria-hidden />
      ) : (
        <SourceIcon kind={item.source.kind} className="size-5" />
      )}
    </div>
  )
}
