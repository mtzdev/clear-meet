import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DATE_PRESET_LABEL,
  DATE_PRESETS,
  NO_DATE_FILTER,
  type DateFilter,
  type DatePreset
} from '@/lib/date-range'
import { isLibrarySort, type LibrarySort } from '@shared/library'

const SORT_LABEL: Record<LibrarySort, string> = {
  newest: 'Mais recentes',
  oldest: 'Mais antigas',
  longest: 'Mais longas',
  relevance: 'Relevância'
}

interface LibraryFiltersProps {
  text: string
  onText: (text: string) => void
  date: DateFilter
  onDate: (date: DateFilter) => void
  sort: LibrarySort
  onSort: (sort: LibrarySort) => void
  /** Há texto na busca: a ordenação por relevância passa a existir. */
  searching: boolean
}

function isPreset(value: string): value is DatePreset {
  return (DATE_PRESETS as readonly string[]).includes(value)
}

/** Busca por texto, intervalo de datas e ordenação da lista de Reuniões. */
export function LibraryFilters({
  text,
  onText,
  date,
  onDate,
  sort,
  onSort,
  searching
}: LibraryFiltersProps) {
  const sorts: LibrarySort[] = searching
    ? ['relevance', 'newest', 'oldest', 'longest']
    : ['newest', 'oldest', 'longest']
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            type="search"
            value={text}
            onChange={(event) => onText(event.target.value)}
            placeholder="Buscar no nome, na conversa, nas Anotações e no Resumo"
            aria-label="Buscar Reuniões"
            maxLength={200}
            className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {text !== '' && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
              aria-label="Limpar a busca"
              onClick={() => onText('')}
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
        <Select
          value={date.preset}
          onValueChange={(value) => {
            if (isPreset(value)) onDate({ ...date, preset: value })
          }}
        >
          <SelectTrigger aria-label="Período" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {DATE_PRESET_LABEL[preset]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(value) => {
            if (isLibrarySort(value)) onSort(value)
          }}
        >
          <SelectTrigger aria-label="Ordenar por" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorts.map((option) => (
              <SelectItem key={option} value={option}>
                {SORT_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {date.preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">De</span>
            <Input
              type="date"
              value={date.from}
              max={date.to || undefined}
              onChange={(event) => onDate({ ...date, from: event.target.value })}
              className="w-40"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">até</span>
            <Input
              type="date"
              value={date.to}
              min={date.from || undefined}
              onChange={(event) => onDate({ ...date, to: event.target.value })}
              className="w-40"
            />
          </label>
          {(date.from !== '' || date.to !== '') && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDate({ ...NO_DATE_FILTER, preset: 'custom' })}
            >
              Limpar datas
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
