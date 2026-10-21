import { Folder } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { UNGROUPED_FILTER, type GroupInfo } from '@shared/groups'

const ALL = '__all__'

interface GroupFilterProps {
  groups: readonly GroupInfo[]
  /** `null` = todas; `UNGROUPED_FILTER` = sem grupo; senão o id do grupo. */
  value: string | null
  onChange: (value: string | null) => void
}

/** Filtro da lista por grupo (ou só as Reuniões sem grupo). */
export function GroupFilter({ groups, value, onChange }: GroupFilterProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground mr-1 flex items-center gap-1 text-[11px]">
        <Folder className="size-3" aria-hidden />
        Grupo
      </span>
      <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
        <SelectTrigger aria-label="Filtrar por grupo" size="sm" className="w-44 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          <SelectItem value={UNGROUPED_FILTER}>Sem grupo</SelectItem>
          {groups.length > 0 && <SelectSeparator />}
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
