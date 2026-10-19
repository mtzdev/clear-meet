import { useRef, useState, type PointerEvent } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePlayerValue, type PlayerController } from '@/lib/player-controller'
import type { MeetingNote } from '@shared/meeting'
import { formatInstant, instantAtPosition, markerPosition } from '@shared/timeline'

interface TimelineProps {
  controller: PlayerController
  notes: readonly MeetingNote[]
}

export function Timeline({ controller, notes }: TimelineProps) {
  const currentMs = usePlayerValue(controller, (snapshot) => snapshot.currentMs)
  const durationMs = usePlayerValue(controller, (snapshot) => snapshot.durationMs)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [hover, setHover] = useState<{ ms: number; x: number } | null>(null)

  const seekTo = (clientX: number): void => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    controller.seekToMs(instantAtPosition((clientX - rect.left) / rect.width, durationMs))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    seekTo(event.clientX)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (rect && rect.width > 0) {
      const offset = Math.min(rect.width, Math.max(0, event.clientX - rect.left))
      setHover({ ms: instantAtPosition(offset / rect.width, durationMs), x: offset })
    }
    if (dragging.current) seekTo(event.clientX)
  }
  const stopDragging = (): void => {
    dragging.current = false
  }

  const played = markerPosition(currentMs, durationMs)

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Posição na Reunião"
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(currentMs / 1000)}
      aria-valuetext={`${formatInstant(currentMs)} de ${formatInstant(durationMs)}`}
      className="group focus-visible:ring-ring/60 relative h-7 flex-1 cursor-pointer touch-none rounded-md outline-none focus-visible:ring-2"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onPointerLeave={() => setHover(null)}
    >
      {hover && (
        <div
          aria-hidden
          className="bg-foreground text-background pointer-events-none absolute bottom-full z-10 mb-0.5 -translate-x-1/2 rounded px-1.5 py-0.5 text-xs tabular-nums"
          style={{ left: `clamp(1.5rem, ${hover.x}px, calc(100% - 1.5rem))` }}
        >
          {formatInstant(hover.ms)}
        </div>
      )}
      <div className="bg-muted absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full">
        <div className="bg-primary h-full" style={{ width: `${played * 100}%` }} />
      </div>
      <div
        aria-hidden
        className="bg-primary absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ left: `${played * 100}%` }}
      />
      {notes.map((note) => (
        <Tooltip key={note.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Anotação em ${formatInstant(note.offsetMs)}: ${note.text}`}
              className="bg-warning ring-background focus-visible:ring-ring absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 transition-transform outline-none hover:scale-125 focus-visible:scale-125 focus-visible:ring-2"
              style={{ left: `${markerPosition(note.offsetMs, durationMs) * 100}%` }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => controller.seekToMs(note.offsetMs)}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64">
            <span className="mr-1.5 tabular-nums opacity-70">{formatInstant(note.offsetMs)}</span>
            <span className="line-clamp-4 whitespace-pre-wrap">{note.text}</span>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
