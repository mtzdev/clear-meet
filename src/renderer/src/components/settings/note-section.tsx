import { CircleCheck, Keyboard, RotateCcw, TriangleAlert } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettings } from '@/lib/recording'
import { DEFAULT_NOTE_SHORTCUT, MAX_NOTE_LEAD_SECONDS } from '@shared/notes'
import { captureShortcut, formatAccelerator, formatModifiers } from '@shared/shortcut'

type Feedback = { tone: 'ok' | 'error'; text: string } | null

function ShortcutRow() {
  const { settings, replace } = useSettings()
  const [capturing, setCapturing] = useState(false)
  const [held, setHeld] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const current = settings?.noteShortcut ?? DEFAULT_NOTE_SHORTCUT

  const save = async (accelerator: string): Promise<void> => {
    setSaving(true)
    setFeedback(null)
    try {
      const result = await window.api.invoke('settings:setNoteShortcut', { accelerator })
      if (!result.ok) {
        setFeedback({ tone: 'error', text: result.error.message })
        return
      }
      replace(result.value)
      setFeedback({ tone: 'ok', text: 'Atalho salvo. Vale a partir da próxima gravação.' })
    } catch {
      setFeedback({ tone: 'error', text: 'Não foi possível salvar o atalho.' })
    } finally {
      setSaving(false)
    }
  }

  const stopCapturing = (): void => {
    setCapturing(false)
    setHeld('')
  }

  const startCapturing = (): void => {
    setFeedback(null)
    setCapturing(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!capturing) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        startCapturing()
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const noModifier = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
    if (event.key === 'Escape' && noModifier) {
      stopCapturing()
      return
    }
    const captured = captureShortcut(event.nativeEvent)
    if (captured.kind === 'pending') {
      setHeld(formatModifiers(captured.modifiers))
      return
    }
    if (captured.kind === 'invalid') {
      setFeedback({ tone: 'error', text: captured.message })
      return
    }
    stopCapturing()
    void save(captured.accelerator)
  }

  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div id="note-shortcut-label" className="text-sm font-medium">
            Atalho para anotar
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Abre o campo de Anotação durante a gravação, de qualquer programa.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {current !== DEFAULT_NOTE_SHORTCUT && !capturing && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || !settings}
              onClick={() => void save(DEFAULT_NOTE_SHORTCUT)}
            >
              <RotateCcw aria-hidden />
              Restaurar padrão
            </Button>
          )}
          <Button
            variant="outline"
            aria-labelledby="note-shortcut-label"
            aria-live="polite"
            disabled={saving || !settings}
            className="min-w-44 font-mono text-xs"
            onClick={startCapturing}
            onKeyDown={onKeyDown}
            // Espaço e Enter ativam o botão ao soltar a tecla: isso refaria a captura que acabou de terminar.
            onKeyUp={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.preventDefault()
            }}
            onBlur={stopCapturing}
          >
            <Keyboard aria-hidden />
            {capturing
              ? held !== ''
                ? `${held} + …`
                : 'Pressione as teclas…'
              : formatAccelerator(current)}
          </Button>
        </div>
      </div>
      {capturing && (
        <p className="text-muted-foreground text-xs">
          Use Ctrl, Alt ou Win junto com outra tecla. Esc cancela.
        </p>
      )}
      {feedback && (
        <p
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          className={
            feedback.tone === 'ok'
              ? 'text-success flex items-start gap-1.5 text-xs'
              : 'text-destructive flex items-start gap-1.5 text-xs'
          }
        >
          {feedback.tone === 'ok' ? (
            <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          ) : (
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          {feedback.text}
        </p>
      )}
    </div>
  )
}

function LeadRow() {
  const { settings, update } = useSettings()
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? String(settings?.noteLeadSeconds ?? '')

  const commit = (): void => {
    if (draft === null) return
    const parsed = Number(draft)
    setDraft(null)
    if (draft.trim() === '' || !Number.isFinite(parsed)) return
    const seconds = Math.min(MAX_NOTE_LEAD_SECONDS, Math.max(0, Math.round(parsed)))
    if (seconds !== settings?.noteLeadSeconds) update({ noteLeadSeconds: seconds })
  }

  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <label htmlFor="note-lead" className="text-sm font-medium">
          Recuo da Anotação
        </label>
        <p className="text-muted-foreground mt-0.5 text-xs">
          A Anotação aponta para alguns segundos antes de você começar a digitar.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          id="note-lead"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_NOTE_LEAD_SECONDS}
          step={1}
          className="w-20 text-right"
          disabled={!settings}
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
        <span className="text-muted-foreground text-sm">segundos</span>
      </div>
    </div>
  )
}

/** Anotações ao vivo: atalho global e quanto o Instante recua. */
export function NoteSection() {
  return (
    <>
      <ShortcutRow />
      <LeadRow />
    </>
  )
}
