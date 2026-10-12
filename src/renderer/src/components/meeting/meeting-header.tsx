import { ChevronLeft, FolderOpen, LoaderCircle, Pencil } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { SourceIcon } from '@/components/meeting/source-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime, formatDuration } from '@/lib/format'
import { SOURCE_KIND_LABEL } from '@/lib/meeting-text'
import type { MeetingDetail } from '@shared/library'

const MAX_NAME_LENGTH = 120

interface MeetingHeaderProps {
  detail: MeetingDetail
  canRename: boolean
  onRename: (name: string) => Promise<string | null>
}

export function MeetingHeader({ detail, canRename, onRename }: MeetingHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(detail.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Evita confirmar duas vezes (Enter e depois o blur) ou confirmar após Esc. */
  const busy = useRef(false)

  const startEditing = (): void => {
    setName(detail.name)
    setError(null)
    busy.current = false
    setEditing(true)
  }

  const commit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (busy.current) return
    const trimmed = name.replace(/\s+/g, ' ').trim()
    if (trimmed === '' || trimmed === detail.name) {
      setEditing(false)
      return
    }
    busy.current = true
    setSaving(true)
    const failure = await onRename(trimmed)
    busy.current = false
    setSaving(false)
    if (failure) setError(failure)
    else setEditing(false)
  }

  const meta = [
    formatDateTime(detail.createdAt),
    detail.durationMs !== null ? formatDuration(detail.durationMs) : null
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  return (
    <header className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Button asChild variant="ghost" size="icon-sm">
        <a href="#/meetings" aria-label="Voltar para Reuniões">
          <ChevronLeft aria-hidden />
        </a>
      </Button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={(event) => void commit(event)} className="flex items-center gap-2">
            <Input
              value={name}
              autoFocus
              maxLength={MAX_NAME_LENGTH}
              aria-label="Nome da Reunião"
              aria-invalid={error !== null}
              disabled={saving}
              className="h-8 max-w-md"
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  busy.current = true
                  setEditing(false)
                  window.setTimeout(() => (busy.current = false), 0)
                }
              }}
            />
            {saving && (
              <LoaderCircle className="text-muted-foreground size-4 animate-spin" aria-hidden />
            )}
            {error && <span className="text-destructive truncate text-xs">{error}</span>}
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <h1 id="screen-title" className="truncate text-base font-semibold tracking-tight">
              {detail.name}
            </h1>
            {canRename && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Renomear a Reunião"
                onClick={startEditing}
              >
                <Pencil aria-hidden />
              </Button>
            )}
          </div>
        )}
        <p className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
          <SourceIcon kind={detail.source.kind} className="size-3" />
          <span className="truncate">
            {SOURCE_KIND_LABEL[detail.source.kind]}
            {meta ? ` · ${meta}` : ''}
          </span>
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => void window.api.invoke('meeting:reveal', { folder: detail.folder })}
      >
        <FolderOpen aria-hidden />
        <span className="hidden min-[1000px]:inline">Abrir pasta</span>
      </Button>
    </header>
  )
}
