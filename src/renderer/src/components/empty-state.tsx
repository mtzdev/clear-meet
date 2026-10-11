import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}

/** Estado vazio centralizado: ícone, título, explicação e (opcional) uma ação. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 py-12 text-center">
      <div className="bg-accent text-accent-foreground grid size-14 place-items-center rounded-2xl">
        <Icon className="size-6" aria-hidden />
      </div>
      <div className="max-w-sm space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed text-balance">{description}</p>
      </div>
      {action}
    </div>
  )
}
