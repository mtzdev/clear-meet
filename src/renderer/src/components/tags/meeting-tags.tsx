import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/tags/confirm-dialog'
import { TagMenu } from '@/components/tags/tag-menu'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { settle } from '@/lib/tags'
import { cn } from '@/lib/utils'
import { MAX_TAGS_PER_MEETING, renameInList, tagKey, withoutTag, type TagInfo } from '@shared/tags'

interface MeetingTagsProps {
  folder: string
  tags: readonly string[]
  /** Motivo de a Reunião não poder ser marcada agora (gravando, processando), ou `null`. */
  blockedReason: string | null
  className?: string
  /** Classes do botão "+" (o cartão o esconde até o mouse chegar). */
  addClassName?: string
  onChange?: (tags: string[]) => void
}

type Pending =
  { kind: 'delete'; tag: TagInfo } | { kind: 'merge'; from: string; target: TagInfo } | null

const reunioes = (count: number): string => (count === 1 ? '1 Reunião' : `${count} Reuniões`)

const TAG_BUTTON =
  'text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60'

/**
 * Tags de uma Reunião em linha, entre colchetes e discretas, para ficar logo depois do nome.
 * Clicar numa Tag ou no "+" abre o popover que marca, cria, renomeia e apaga Tags. As mudanças
 * aparecem na hora e valem até o índice trazer as Tags novas.
 */
export function MeetingTags({
  folder,
  tags,
  blockedReason,
  className,
  addClassName,
  onChange
}: MeetingTagsProps) {
  const base = tags.join('\u0000')
  const [override, setOverride] = useState<{ base: string; tags: string[] } | null>(null)
  const current = override?.base === base ? override.tags : [...tags]
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Pending>(null)

  const apply = (next: string[]): void => {
    setOverride({ base, tags: next })
    onChange?.(next)
  }

  const rename = async (from: string, to: string): Promise<string | null> => {
    const result = await settle(window.api.invoke('tags:rename', { from, to }))
    if (!result.ok) return result.error.message
    apply(renameInList(current, from, result.value.name))
    return null
  }

  const confirm = async (): Promise<string | null> => {
    if (!pending) return null
    if (pending.kind === 'merge') return rename(pending.from, pending.target.name)
    const result = await settle(window.api.invoke('tags:delete', { name: pending.tag.name }))
    if (!result.ok) return result.error.message
    apply(withoutTag(current, pending.tag.name))
    return null
  }

  const blocked = blockedReason !== null
  const guard = (event: { preventDefault: () => void }): void => {
    if (blocked) event.preventDefault()
  }
  const deleting = pending?.kind === 'delete' ? pending : null
  const merging = pending?.kind === 'merge' ? pending : null

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px]', className)}>
      <Popover open={open && !blocked} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <span className="inline-flex items-center gap-1">
            {current.slice(0, MAX_TAGS_PER_MEETING).map((name) => (
              <PopoverTrigger asChild key={tagKey(name)}>
                <button
                  type="button"
                  aria-disabled={blocked}
                  title={blockedReason ?? 'Gerenciar Tags'}
                  className={cn(TAG_BUTTON, 'max-w-32 truncate')}
                  onClick={guard}
                >
                  [{name}]
                </button>
              </PopoverTrigger>
            ))}
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Adicionar Tag"
                aria-disabled={blocked}
                title={blockedReason ?? 'Adicionar Tag'}
                className={cn(
                  TAG_BUTTON,
                  'inline-flex items-center gap-0.5 data-[state=open]:opacity-100',
                  addClassName
                )}
                onClick={guard}
              >
                <Plus className="size-3" aria-hidden />
                {current.length === 0 && 'Tag'}
              </button>
            </PopoverTrigger>
          </span>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-64 p-2"
          onContextMenu={(event) => event.stopPropagation()}
        >
          <TagMenu
            folder={folder}
            current={current}
            onChange={apply}
            onRename={rename}
            onMerge={(from, target) => {
              setOpen(false)
              setPending({ kind: 'merge', from, target })
            }}
            onDelete={(tag) => {
              setOpen(false)
              setPending({ kind: 'delete', tag })
            }}
          />
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title={`Apagar a Tag “${deleting?.tag.name ?? ''}”?`}
        description={
          deleting && deleting.tag.count > 0 ? (
            <p>
              Ela será removida de {reunioes(deleting.tag.count)}. As Reuniões não são apagadas.
            </p>
          ) : (
            <p>Nenhuma Reunião usa esta Tag.</p>
          )
        }
        confirmLabel="Apagar Tag"
        destructive
        onConfirm={confirm}
      />
      <ConfirmDialog
        open={merging !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title={`Juntar com “${merging?.target.name ?? ''}”?`}
        description={
          merging && (
            <p>
              Já existe a Tag “{merging.target.name}”. As Reuniões com “{merging.from}” passam a ter
              “{merging.target.name}”, e “{merging.from}” deixa de existir.
            </p>
          )
        }
        confirmLabel="Juntar"
        onConfirm={confirm}
      />
    </span>
  )
}
