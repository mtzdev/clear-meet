import { LoaderCircle } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'

const MAX_NAME_LENGTH = 120

interface TitleEditorProps {
  name: string
  /** Salva o novo nome; devolve a mensagem de erro ou `null` se deu certo. */
  onSave: (name: string) => Promise<string | null>
  onClose: () => void
}

/** Edição do nome da Reunião na própria linha: Enter e perder o foco salvam, Esc cancela. */
export function TitleEditor({ name, onSave, onClose }: TitleEditorProps) {
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Evita salvar duas vezes (Enter e depois o blur) ou salvar depois do Esc. */
  const busy = useRef(false)

  const commit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (busy.current) return
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (trimmed === '' || trimmed === name) {
      onClose()
      return
    }
    busy.current = true
    setSaving(true)
    const failure = await onSave(trimmed)
    busy.current = false
    setSaving(false)
    if (failure) setError(failure)
    else onClose()
  }

  return (
    <form
      onSubmit={(event) => void commit(event)}
      className="relative z-10 flex min-w-0 flex-1 items-center gap-2"
    >
      <Input
        value={value}
        autoFocus
        maxLength={MAX_NAME_LENGTH}
        aria-label="Nome da Reunião"
        aria-invalid={error !== null}
        disabled={saving}
        className="h-7 max-w-md px-2 text-sm"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            busy.current = true
            onClose()
          }
        }}
      />
      {saving && (
        <LoaderCircle className="text-muted-foreground size-4 shrink-0 animate-spin" aria-hidden />
      )}
      {error && (
        <span role="alert" className="text-destructive truncate text-xs">
          {error}
        </span>
      )}
    </form>
  )
}
