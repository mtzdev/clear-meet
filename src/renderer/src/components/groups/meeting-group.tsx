import { ChevronDown, Folder, Plus } from 'lucide-react'
import { useState } from 'react'
import { GroupDialog } from '@/components/groups/group-dialog'
import { GroupPicker } from '@/components/groups/group-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { findGroup, moveToGroup } from '@/lib/groups'
import { groupHref } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { GroupInfo, GroupsOverview } from '@shared/groups'

interface MeetingGroupProps {
  folder: string
  /** `groupId` da Reunião; vale o que o usuário acabou de escolher até o índice trazer o novo. */
  groupId: string | null
  overview: GroupsOverview | null
  /** Motivo de a Reunião não poder mudar de grupo agora (gravando, processando), ou `null`. */
  blockedReason: string | null
  className?: string
  /** Classes do botão "Grupo" (o cartão o esconde até o mouse chegar). */
  addClassName?: string
  onChanged?: (groupId: string | null) => void
}

const BUTTON =
  'text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60'

/**
 * Grupo da Reunião: o nome leva à tela do grupo e a seta abre a troca rápida. Sem grupo, só
 * aparece o botão para escolher um.
 */
export function MeetingGroup({
  folder,
  groupId,
  overview,
  blockedReason,
  className,
  addClassName,
  onChanged
}: MeetingGroupProps) {
  const [override, setOverride] = useState<{ base: string | null; value: string | null } | null>(
    null
  )
  const current = override?.base === groupId ? override.value : groupId
  const group = findGroup(overview, current)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blocked = blockedReason !== null
  const editable = overview?.editable ?? false

  const pick = async (next: string | null): Promise<void> => {
    if (busy) return
    if (next === (group?.id ?? null)) {
      setOpen(false)
      return
    }
    setBusy(true)
    setError(null)
    const failure = await moveToGroup([folder], next)
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    setOverride({ base: groupId, value: next })
    onChanged?.(next)
    setOpen(false)
  }

  const created = (made: GroupInfo): void => {
    void pick(made.id)
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-0.5 text-[11px]', className)}>
      <Popover open={open && !blocked} onOpenChange={setOpen}>
        {group ? (
          <>
            <a
              href={groupHref(group.id)}
              title={`Abrir o grupo ${group.name}`}
              className={cn(
                BUTTON,
                'inline-flex max-w-40 items-center gap-1 truncate px-0.5 font-medium'
              )}
            >
              <Folder className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{group.name}</span>
            </a>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Trocar de grupo"
                aria-disabled={blocked}
                title={blockedReason ?? 'Trocar de grupo'}
                className={cn(BUTTON, 'px-0.5')}
                onClick={(event) => {
                  if (blocked) event.preventDefault()
                }}
              >
                <ChevronDown className="size-3" aria-hidden />
              </button>
            </PopoverTrigger>
          </>
        ) : (
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Adicionar a um grupo"
              aria-disabled={blocked}
              title={blockedReason ?? 'Adicionar a um grupo'}
              className={cn(
                BUTTON,
                'inline-flex items-center gap-0.5 data-[state=open]:opacity-100',
                addClassName
              )}
              onClick={(event) => {
                if (blocked) event.preventDefault()
              }}
            >
              <Plus className="size-3" aria-hidden />
              Grupo
            </button>
          </PopoverTrigger>
        )}
        <PopoverContent
          align="start"
          className="w-72 p-2"
          onContextMenu={(event) => event.stopPropagation()}
        >
          {overview === null ? (
            <p className="text-muted-foreground px-1 py-2 text-xs">Carregando…</p>
          ) : (
            <GroupPicker
              groups={overview.groups}
              current={group?.id ?? null}
              disabled={busy}
              onPick={(next) => void pick(next)}
              {...(editable
                ? {
                    onCreate: () => {
                      setOpen(false)
                      setCreating(true)
                    }
                  }
                : {})}
            />
          )}
          {error && (
            <p role="alert" className="text-destructive px-1 pt-2 text-xs">
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
      <GroupDialog open={creating} onOpenChange={setCreating} onSaved={created} />
    </span>
  )
}
