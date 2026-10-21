import { FolderInput, FolderMinus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SelectionBarProps {
  count: number
  /** Alguma das Reuniões escolhidas está em um grupo. */
  anyGrouped: boolean
  allSelected: boolean
  busy: boolean
  error: string | null
  /** Os grupos não podem ser alterados (pasta somente leitura). */
  disabled: boolean
  onMove: () => void
  onRemove: () => void
  onSelectAll: () => void
  onClear: () => void
}

/** Barra fixa no rodapé da lista quando há Reuniões escolhidas: mover para grupo ou tirar do grupo. */
export function SelectionBar({
  count,
  anyGrouped,
  allSelected,
  busy,
  error,
  disabled,
  onMove,
  onRemove,
  onSelectAll,
  onClear
}: SelectionBarProps) {
  return (
    <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center px-8">
      <div
        role="toolbar"
        aria-label="Ações para as Reuniões escolhidas"
        className="bg-popover text-popover-foreground border-border pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 shadow-lg"
      >
        <span className="px-1 text-sm font-medium tabular-nums" role="status">
          {count === 1 ? '1 escolhida' : `${count} escolhidas`}
        </span>
        <Button size="sm" disabled={busy || disabled} onClick={onMove}>
          <FolderInput aria-hidden />
          Mover para grupo…
        </Button>
        {anyGrouped && (
          <Button size="sm" variant="outline" disabled={busy || disabled} onClick={onRemove}>
            <FolderMinus aria-hidden />
            Tirar do grupo
          </Button>
        )}
        {!allSelected && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onSelectAll}>
            Escolher todas
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
          <X aria-hidden />
          Limpar
        </Button>
        {error && (
          <p role="alert" className="text-destructive basis-full px-1 text-xs">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
