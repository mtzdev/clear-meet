import { NotebookText } from 'lucide-react'
import { useEffect, useRef, useState, type FocusEvent } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { meetingHref } from '@/lib/router'
import { notePreview, type NotePreviewItem } from '@shared/notes'

const OPEN_DELAY_MS = 120
const CLOSE_DELAY_MS = 180

interface NotesPreviewProps {
  meetingId: string
  count: number
}

/**
 * Contador de Anotações da linha. Passar o mouse ou focar abre uma janelinha com as Anotações
 * (Instante + texto); ela continua aberta enquanto o ponteiro ou o foco estiver no contador ou
 * nela, e cada Anotação abre a Reunião naquele Instante.
 */
export function NotesPreview({ meetingId, count }: NotesPreviewProps) {
  const label = count === 1 ? 'Anotação' : 'Anotações'
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<NotePreviewItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  /** O foco entra na janelinha só quando ela foi aberta pelo teclado. */
  const focusInside = useRef(false)
  /** O ponteiro está no contador ou na janelinha (perder o foco ali não fecha). */
  const hovering = useRef(false)

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.api.invoke('library:notes', { id: meetingId }).then(
      (result) => {
        if (cancelled) return
        setFailed(!result.ok)
        if (result.ok) setNotes(notePreview(result.value))
      },
      () => {
        if (!cancelled) setFailed(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [open, meetingId])

  if (count === 0) {
    return (
      <span className="flex items-center gap-1 tabular-nums">
        <NotebookText className="size-3.5" aria-hidden />0<span className="sr-only">{label}</span>
      </span>
    )
  }

  const schedule = (next: boolean, delay: number): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), delay)
  }
  const cancel = (): void => clearTimeout(timer.current)
  const enter = (delay: number | null): void => {
    hovering.current = true
    if (delay === null) cancel()
    else schedule(true, delay)
  }
  const leave = (): void => {
    hovering.current = false
    schedule(false, CLOSE_DELAY_MS)
  }
  const blurred = (event: FocusEvent): void => {
    const next = event.relatedTarget
    const inside =
      next instanceof Node && (trigger.current?.contains(next) || content.current?.contains(next))
    if (!inside && !hovering.current) schedule(false, CLOSE_DELAY_MS)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          className="hover:bg-accent focus-visible:ring-ring/60 relative z-10 -mx-1 flex items-center gap-1 rounded px-1 tabular-nums outline-none focus-visible:ring-2"
          onPointerEnter={() => enter(OPEN_DELAY_MS)}
          onPointerLeave={leave}
          onFocus={() => schedule(true, 0)}
          onBlur={blurred}
          onClick={(event) => {
            cancel()
            // `detail` é 0 quando o clique veio do teclado (Enter ou Espaço).
            focusInside.current = event.detail === 0
            setOpen(true)
          }}
        >
          <NotebookText className="size-3.5" aria-hidden />
          {count}
          <span className="sr-only">{label}</span>
        </button>
      </PopoverAnchor>
      <PopoverContent
        ref={content}
        side="bottom"
        align="start"
        aria-label={`${label} da Reunião`}
        className="max-h-64 w-[300px] overflow-y-auto p-1 duration-150"
        onContextMenu={(event) => event.stopPropagation()}
        onPointerEnter={() => enter(null)}
        onPointerLeave={leave}
        onFocus={cancel}
        onBlur={blurred}
        onOpenAutoFocus={(event) => {
          if (!focusInside.current) event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (focusInside.current) trigger.current?.focus()
          focusInside.current = false
        }}
        onInteractOutside={(event) => {
          if (trigger.current?.contains(event.target as Node)) event.preventDefault()
        }}
      >
        {failed && notes === null && (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            Não foi possível carregar as Anotações.
          </p>
        )}
        {!failed && notes === null && (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">Carregando…</p>
        )}
        {notes !== null && notes.length === 0 && (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">Nenhuma Anotação.</p>
        )}
        {notes !== null && notes.length > 0 && (
          <ul>
            {notes.map((note) => (
              <li key={note.id}>
                <a
                  href={meetingHref(meetingId, note.offsetMs)}
                  className="hover:bg-accent focus-visible:bg-accent flex gap-2.5 rounded px-2 py-1.5 text-xs outline-none"
                >
                  <span className="text-primary min-w-10 shrink-0 font-medium tabular-nums">
                    {note.label}
                  </span>
                  <span className="min-w-0 flex-1 leading-relaxed break-words whitespace-pre-wrap">
                    {note.text}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
