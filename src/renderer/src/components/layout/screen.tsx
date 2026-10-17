import type { ReactNode } from 'react'

interface ScreenProps {
  title: string
  /** Botões à direita do título. */
  actions?: ReactNode
  children: ReactNode
}

/** Moldura de uma área: cabeçalho fixo com o título e corpo rolável. */
export function Screen({ title, actions, children }: ScreenProps) {
  return (
    <section aria-labelledby="screen-title" className="flex h-full min-h-0 flex-col">
      <header className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-8">
        <h1 id="screen-title" className="text-base font-semibold tracking-tight">
          {title}
        </h1>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}
