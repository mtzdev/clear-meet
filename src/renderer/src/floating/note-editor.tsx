import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { MAX_NOTE_LENGTH } from '@shared/notes'

/**
 * Campo de Anotação, aberto por cima de qualquer app. Enter salva, Shift+Enter quebra a
 * linha, Esc cancela; texto vazio não salva. O Instante é fixado pelo main na primeira
 * alteração do texto (`notes:begin`), não no salvamento.
 */
export function NoteEditor() {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const began = useRef(false)
  const textRef = useRef('')
  const hasFocused = useRef(false)

  // O main reaproveita esta janela: a cada abertura, começa do zero e foca o campo.
  useEffect(() => {
    const reset = (): void => {
      began.current = false
      textRef.current = ''
      setText('')
      setError(null)
      setSaving(false)
      areaRef.current?.focus()
    }
    const off = window.api.on('notes:opened', reset)
    const onFocus = (): void => {
      hasFocused.current = true
      areaRef.current?.focus()
    }
    // Clicou em outro app sem escrever nada: o campo se fecha sozinho (com texto, fica à espera).
    const onBlur = (): void => {
      if (hasFocused.current && textRef.current.trim() === '') {
        void window.api.invoke('notes:cancel')
      }
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    textRef.current = value
    setText(value)
    setError(null)
    if (!began.current) {
      began.current = true
      void window.api.invoke('notes:begin')
    }
  }

  const save = async () => {
    if (saving || text.trim() === '') return
    setSaving(true)
    try {
      const result = await window.api.invoke('notes:save', { text })
      if (!result.ok) setError(result.error.message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      void window.api.invoke('notes:cancel')
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void save()
    }
  }

  return (
    <div className="h-full w-full p-1.5">
      <div className="bg-card text-card-foreground border-border flex h-full flex-col gap-2 rounded-2xl border p-3 shadow-lg">
        <textarea
          ref={areaRef}
          autoFocus
          value={text}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Escreva a Anotação…"
          aria-label="Anotação"
          onChange={onChange}
          onKeyDown={onKeyDown}
          className="bg-background border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-0 w-full flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : (
            <p className="text-muted-foreground">
              <kbd className="font-sans font-medium">Enter</kbd> salva ·{' '}
              <kbd className="font-sans font-medium">Shift+Enter</kbd> nova linha ·{' '}
              <kbd className="font-sans font-medium">Esc</kbd> cancela
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
