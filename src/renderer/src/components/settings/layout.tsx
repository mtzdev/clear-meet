import type { ReactNode } from 'react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h2>
      <div className="bg-card divide-border border-border divide-y rounded-xl border">
        {children}
      </div>
    </section>
  )
}

export function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div>}
      </div>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  )
}

export function Path({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">-</span>
  return (
    <span
      title={value}
      className="text-muted-foreground block max-w-[22rem] truncate font-mono text-xs"
    >
      {value}
    </span>
  )
}
