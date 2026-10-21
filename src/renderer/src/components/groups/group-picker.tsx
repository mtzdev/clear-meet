import { Check, FolderMinus, Plus, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { meetingCountText } from '@/lib/groups'
import type { GroupInfo } from '@shared/groups'

const ITEM =
  'hover:bg-accent focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50'

interface GroupPickerProps {
  groups: readonly GroupInfo[]
  /** Grupo atual (comum a todas as Reuniões escolhidas); `null` = sem grupo; ausente = misturado. */
  current?: string | null | undefined
  disabled?: boolean
  /** Mostra "Sem grupo" como opção. */
  allowNone?: boolean
  onPick: (groupId: string | null) => void
  /** "Novo grupo…"; ausente quando os grupos não podem ser alterados. */
  onCreate?: () => void
}

/** Lista de grupos para escolher onde pôr as Reuniões: um só por Reunião, então escolher troca. */
export function GroupPicker({
  groups,
  current,
  disabled = false,
  allowNone = true,
  onPick,
  onCreate
}: GroupPickerProps) {
  return (
    <ul className="max-h-64 space-y-0.5 overflow-y-auto" aria-label="Grupos">
      {groups.map((group) => (
        <li key={group.id}>
          <button
            type="button"
            className={ITEM}
            disabled={disabled}
            aria-pressed={group.id === current}
            onClick={() => onPick(group.id)}
          >
            <Check
              className={cn(
                'size-3.5 shrink-0',
                group.id === current ? 'opacity-100' : 'opacity-0'
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
            {group.rules !== null && (
              <Zap className="text-muted-foreground size-3 shrink-0" aria-label="Automático" />
            )}
            <span className="text-muted-foreground text-xs tabular-nums">
              {meetingCountText(group.count)}
            </span>
          </button>
        </li>
      ))}
      {groups.length === 0 && (
        <li className="text-muted-foreground px-2 py-1.5 text-xs">Nenhum grupo ainda.</li>
      )}
      {allowNone && (
        <li>
          <button
            type="button"
            className={ITEM}
            disabled={disabled}
            aria-pressed={current === null}
            onClick={() => onPick(null)}
          >
            <Check
              className={cn('size-3.5 shrink-0', current === null ? 'opacity-100' : 'opacity-0')}
              aria-hidden
            />
            <FolderMinus className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Sem grupo</span>
          </button>
        </li>
      )}
      {onCreate && (
        <li className="border-border mt-1 border-t pt-1">
          <button type="button" className={ITEM} disabled={disabled} onClick={onCreate}>
            <Plus className="size-3.5 shrink-0" aria-hidden />
            Novo grupo…
          </button>
        </li>
      )}
    </ul>
  )
}
