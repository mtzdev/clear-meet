import { NotebookPen, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { usePlayerValue, type PlayerController } from '@/lib/player-controller'
import { cn } from '@/lib/utils'
import type { MeetingNote } from '@shared/meeting'
import { insertNote, MAX_NOTE_LENGTH } from '@shared/notes'
import { currentNoteId, formatInstant } from '@shared/timeline'

const UNDO_WINDOW_MS = 8000

interface NotesTabProps {
  folder: string
  notes: readonly MeetingNote[]
  locked: boolean
  controller: PlayerController
  onNotesChange: (update: (notes: MeetingNote[]) => MeetingNote[]) => void
  /** A pasta não existe mais (movida/renomeada por fora): a tela recarrega a Reunião. */
  onStale: () => void
}

/** Enter confirma, Shift+Enter quebra a linha; durante composição (IME) nada é confirmado. */
function isConfirmKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing
}

function NoteRow({
  note,
  current,
  locked,
  controller,
  onEdit,
  onDelete
}: {
  note: MeetingNote
  current: boolean
  locked: boolean
  controller: PlayerController
  onEdit: (note: MeetingNote, text: string) => Promise<string | null>
  onDelete: (note: MeetingNote) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEditing = (): void => {
    setText(note.text)
    setError(null)
    setEditing(true)
  }

  const save = async (): Promise<void> => {
    const trimmed = text.trim()
    if (trimmed === '' || trimmed === note.text) {
      setEditing(false)
      return
    }
    setSaving(true)
    const failure = await onEdit(note, trimmed)
    setSaving(false)
    if (failure) setError(failure)
    else setEditing(false)
  }

  return (
    <li
      className={cn(
        'group border-border flex gap-3 border-b px-4 py-3 text-sm',
        current && 'bg-accent/50'
      )}
      aria-current={current ? 'true' : undefined}
    >
      <button
        type="button"
        className="text-primary focus-visible:ring-ring/60 mt-px h-fit shrink-0 rounded text-xs font-medium tabular-nums outline-none hover:underline focus-visible:ring-2"
        aria-label={`Ir para ${formatInstant(note.offsetMs)}`}
        onClick={() => controller.seekToMs(note.offsetMs)}
      >
        {formatInstant(note.offsetMs)}
      </button>

      {editing ? (
        <div className="min-w-0 flex-1 space-y-2">
          <Textarea
            value={text}
            autoFocus
            maxLength={MAX_NOTE_LENGTH}
            aria-label="Texto da Anotação"
            disabled={saving}
            className="min-h-0"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (isConfirmKey(event)) {
                event.preventDefault()
                void save()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(false)
              }
            }}
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex gap-2">
            <Button size="xs" disabled={saving || text.trim() === ''} onClick={() => void save()}>
              Salvar
            </Button>
            <Button size="xs" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">{note.text}</p>
          {!locked && (
            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Editar Anotação"
                onClick={startEditing}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Excluir Anotação"
                onClick={() => onDelete(note)}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          )}
        </>
      )}
    </li>
  )
}

export function NotesTab({
  folder,
  notes,
  locked,
  controller,
  onNotesChange,
  onStale
}: NotesTabProps) {
  const [draft, setDraft] = useState('')
  /** Instante fixado na primeira tecla do rascunho (o vídeo segue tocando enquanto se digita). */
  const [anchorMs, setAnchorMs] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<MeetingNote | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)

  const liveSeconds = usePlayerValue(controller, (snapshot) =>
    Math.floor(snapshot.currentMs / 1000)
  )
  const currentId = usePlayerValue(controller, (snapshot) =>
    currentNoteId(notes, snapshot.currentMs)
  )

  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  const fail = (code: string, message: string): string => {
    if (code === 'not-found') onStale()
    return message
  }

  const changeDraft = (value: string): void => {
    if (draft === '' && value !== '') setAnchorMs(controller.getSnapshot().currentMs)
    if (value === '') setAnchorMs(null)
    setDraft(value)
  }

  const add = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || saving) return
    setSaving(true)
    setError(null)
    const result = await window.api.invoke('meeting:addNote', {
      folder,
      offsetMs: anchorMs ?? controller.getSnapshot().currentMs,
      text
    })
    setSaving(false)
    if (!result.ok) {
      setError(fail(result.error.code, result.error.message))
      return
    }
    const saved = result.value
    onNotesChange((current) => insertNote(current, saved))
    setDraft('')
    setAnchorMs(null)
  }

  const edit = async (note: MeetingNote, text: string): Promise<string | null> => {
    const result = await window.api.invoke('meeting:updateNote', { folder, noteId: note.id, text })
    if (!result.ok) return fail(result.error.code, result.error.message)
    const saved = result.value
    onNotesChange((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)))
    return null
  }

  const remove = async (note: MeetingNote): Promise<void> => {
    setError(null)
    const result = await window.api.invoke('meeting:deleteNote', { folder, noteId: note.id })
    if (!result.ok) {
      setError(fail(result.error.code, result.error.message))
      return
    }
    onNotesChange((current) => current.filter((entry) => entry.id !== note.id))
    setUndo(note)
    window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
  }

  const undoRemove = async (): Promise<void> => {
    const note = undo
    if (!note) return
    window.clearTimeout(undoTimer.current)
    setUndo(null)
    const result = await window.api.invoke('meeting:addNote', {
      folder,
      offsetMs: note.offsetMs,
      text: note.text
    })
    if (!result.ok) {
      setError(fail(result.error.code, result.error.message))
      return
    }
    const restored = result.value
    onNotesChange((current) => insertNote(current, restored))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border shrink-0 space-y-2 border-b p-4">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            {locked ? 'Anotações indisponíveis' : 'Nova Anotação em'}{' '}
            {!locked && (
              <span className="text-foreground font-medium tabular-nums">
                {formatInstant(anchorMs ?? liveSeconds * 1000)}
              </span>
            )}
          </span>
          <span className="hidden min-[420px]:inline">
            Enter salva · Shift+Enter quebra a linha
          </span>
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            rows={1}
            maxLength={MAX_NOTE_LENGTH}
            disabled={locked || saving}
            aria-label="Texto da nova Anotação"
            placeholder={locked ? 'Disponível quando a Reunião terminar' : 'Escreva uma Anotação…'}
            className="max-h-32 min-h-9 resize-none py-1.5"
            onChange={(event) => changeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (isConfirmKey(event)) {
                event.preventDefault()
                void add()
              }
            }}
          />
          <Button
            size="icon"
            aria-label="Adicionar Anotação"
            disabled={locked || saving || draft.trim() === ''}
            onClick={() => void add()}
          >
            <Plus aria-hidden />
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-12 text-center text-sm">
            <NotebookPen className="size-6" aria-hidden />
            <p>Nenhuma Anotação nesta Reunião.</p>
            {!locked && <p>Escreva acima para marcar este ponto do vídeo.</p>}
          </div>
        ) : (
          <ul>
            {notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                current={note.id === currentId}
                locked={locked}
                controller={controller}
                onEdit={edit}
                onDelete={(target) => void remove(target)}
              />
            ))}
          </ul>
        )}
      </div>

      {undo && (
        <div
          role="status"
          className="border-border bg-card flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2 text-sm"
        >
          <span className="text-muted-foreground truncate">Anotação excluída.</span>
          <Button size="sm" variant="ghost" onClick={() => void undoRemove()}>
            <Undo2 aria-hidden />
            Desfazer
          </Button>
        </div>
      )}
    </div>
  )
}
