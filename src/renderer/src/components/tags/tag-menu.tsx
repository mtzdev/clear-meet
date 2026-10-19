import { Check, Pencil, Plus, X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { settle, useTags } from '@/lib/tags'
import { cn } from '@/lib/utils'
import {
  checkTagName,
  hasTag,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_MEETING,
  MAX_TAGS_TEXT,
  tagKey,
  type TagInfo
} from '@shared/tags'

interface TagMenuProps {
  folder: string
  /** Tags da Reunião. */
  current: readonly string[]
  /** Depois de marcar ou desmarcar: as Tags novas da Reunião. */
  onChange: (tags: string[]) => void
  /** Renomear para um nome livre; devolve a mensagem de erro ou `null`. */
  onRename: (from: string, to: string) => Promise<string | null>
  /** Renomear para o nome de outra Tag pede confirmação para juntar. */
  onMerge: (from: string, target: TagInfo) => void
  onDelete: (tag: TagInfo) => void
}

/** Conteúdo do popover: filtra as Tags, marca/desmarca na Reunião, cria, renomeia e apaga. */
export function TagMenu({ folder, current, onChange, onRename, onMerge, onDelete }: TagMenuProps) {
  const { tags } = useTags()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const all = tags ?? []
  const needle = tagKey(query.trim())
  const shown = all.filter((tag) => tagKey(tag.name).includes(needle))
  const typed = checkTagName(query)
  const exact = typed.ok ? all.find((tag) => tagKey(tag.name) === tagKey(typed.name)) : undefined
  const full = current.length >= MAX_TAGS_PER_MEETING
  const canCreate = typed.ok && !exact

  const attach = async (name: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    const selected = hasTag(current, name)
    const result = await settle(
      window.api.invoke(selected ? 'meeting:removeTag' : 'meeting:addTag', { folder, name })
    )
    setBusy(false)
    if (!result.ok) setError(result.error.message)
    else {
      onChange(result.value)
      setQuery('')
    }
  }

  const submitQuery = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!typed.ok) return
    if (exact && hasTag(current, exact.name)) return
    if (full) return
    void attach(exact?.name ?? typed.name)
  }

  const commitRename = async (): Promise<void> => {
    if (!editing || busy) return
    const { name, value } = editing
    const checked = checkTagName(value)
    if (!checked.ok) {
      setError(checked.message)
      return
    }
    if (checked.name === name) {
      setEditing(null)
      return
    }
    const target = all.find(
      (tag) => tagKey(tag.name) === tagKey(checked.name) && tagKey(tag.name) !== tagKey(name)
    )
    if (target) {
      onMerge(name, target)
      return
    }
    setBusy(true)
    setError(null)
    const failure = await onRename(name, checked.name)
    setBusy(false)
    if (failure) setError(failure)
    else setEditing(null)
  }

  return (
    <div className="space-y-2">
      <Input
        value={query}
        autoFocus
        maxLength={MAX_TAG_LENGTH}
        placeholder="Buscar ou criar Tag"
        aria-label="Buscar ou criar Tag"
        className="h-8 text-sm"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={submitQuery}
      />
      {tags === null ? (
        <p className="text-muted-foreground px-1 py-2 text-xs">Carregando…</p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {shown.map((tag) => {
            const selected = hasTag(current, tag.name)
            if (editing && tagKey(editing.name) === tagKey(tag.name)) {
              return (
                <li key={tag.name} className="px-1 py-0.5">
                  <Input
                    value={editing.value}
                    autoFocus
                    maxLength={MAX_TAG_LENGTH}
                    aria-label={`Novo nome da Tag ${tag.name}`}
                    className="h-7 text-sm"
                    disabled={busy}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                    onBlur={() => {
                      if (!busy) setEditing(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void commitRename()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setEditing(null)
                      }
                    }}
                  />
                </li>
              )
            }
            return (
              <li key={tag.name} className="hover:bg-accent flex items-center rounded-md">
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={busy || (full && !selected)}
                  title={full && !selected ? MAX_TAGS_TEXT : undefined}
                  className="focus-visible:ring-ring/60 flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void attach(tag.name)}
                >
                  <Check
                    className={cn('size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">{tag.count}</span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Renomear a Tag ${tag.name}`}
                  className="text-muted-foreground shrink-0"
                  onClick={() => {
                    setError(null)
                    setEditing({ name: tag.name, value: tag.name })
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Apagar a Tag ${tag.name}`}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => onDelete(tag)}
                >
                  <X aria-hidden />
                </Button>
              </li>
            )
          })}
          {canCreate && (
            <li>
              <button
                type="button"
                disabled={busy || full}
                title={full ? MAX_TAGS_TEXT : undefined}
                className="hover:bg-accent focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void attach(typed.name)}
              >
                <Plus className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">Criar “{typed.name}”</span>
              </button>
            </li>
          )}
          {shown.length === 0 && !canCreate && (
            <li className="text-muted-foreground px-2 py-1.5 text-xs">
              {all.length === 0 ? 'Nenhuma Tag ainda. Digite um nome para criar.' : 'Nenhuma Tag.'}
            </li>
          )}
        </ul>
      )}
      {full && <p className="text-muted-foreground px-1 text-xs">{MAX_TAGS_TEXT}.</p>}
      {error && (
        <p role="alert" className="text-destructive px-1 text-xs">
          {error}
        </p>
      )}
    </div>
  )
}
