import { cn } from '@/lib/utils'
import { hasTag, withoutTag, withTag, type TagInfo } from '@shared/tags'

interface TagFilterProps {
  tags: readonly TagInfo[]
  /** Tags marcadas no filtro. */
  selected: readonly string[]
  onChange: (selected: string[]) => void
}

/** Linha de chips com todas as Tags: clicar liga e desliga; várias Tags valem como "qualquer uma". */
export function TagFilter({ tags, selected, onChange }: TagFilterProps) {
  return (
    <div role="group" aria-label="Filtrar por Tag" className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground mr-1 text-[11px]">Tags</span>
      {tags.map((tag) => {
        const active = hasTag(selected, tag.name)
        return (
          <button
            key={tag.name}
            type="button"
            aria-pressed={active}
            className={cn(
              'focus-visible:ring-ring/60 inline-flex max-w-48 items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] outline-none focus-visible:ring-2',
              active
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() =>
              onChange(active ? withoutTag(selected, tag.name) : withTag(selected, tag.name))
            }
          >
            <span className="truncate">[{tag.name}]</span>
            <span className="text-muted-foreground tabular-nums">{tag.count}</span>
          </button>
        )
      })}
    </div>
  )
}
