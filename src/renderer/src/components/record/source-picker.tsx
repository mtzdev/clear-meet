import { AppWindow, Check, Mic, Monitor, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { isSameSource, toRef, AUDIO_ONLY } from '@/lib/source-selection'
import { cn } from '@/lib/utils'
import type { CaptureSourceInfo, CaptureSourceRef } from '@shared/recording'

interface SourcePickerProps {
  sources: CaptureSourceInfo[]
  loading: boolean
  error: string | null
  selected: CaptureSourceRef
  disabled?: boolean
  onSelect: (source: CaptureSourceRef) => void
  onRefresh: () => void
}

function Card({
  selected,
  disabled,
  onClick,
  preview,
  title,
  subtitle,
  icon
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  preview: ReactNode
  title: string
  subtitle: string
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group bg-card relative flex flex-col overflow-hidden rounded-xl border text-left outline-none',
        'transition-[border-color,box-shadow,transform] duration-150',
        'focus-visible:ring-ring/60 focus-visible:ring-2',
        'disabled:pointer-events-none disabled:opacity-60',
        selected
          ? 'border-primary ring-primary/30 shadow-sm ring-2'
          : 'border-border hover:border-input hover:-translate-y-px hover:shadow-sm'
      )}
    >
      <div className="bg-muted relative aspect-video w-full overflow-hidden">
        {preview}
        {selected && (
          <span className="bg-primary text-primary-foreground absolute top-2 right-2 grid size-5 place-items-center rounded-full shadow">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="truncate text-[13px] leading-tight font-medium" title={title}>
            {title}
          </div>
          <div className="text-muted-foreground text-xs">{subtitle}</div>
        </div>
      </div>
    </button>
  )
}

function Thumbnail({ source }: { source: CaptureSourceInfo }) {
  if (!source.thumbnail) {
    return (
      <div className="text-muted-foreground grid h-full place-items-center text-xs">
        Sem pré-visualização
      </div>
    )
  }
  return (
    <img src={source.thumbnail} alt="" className="size-full object-contain" draggable={false} />
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">{children}</div>
    </div>
  )
}

/** Seletor da Fonte de captura: "só áudio", telas e janelas, com miniaturas. */
export function SourcePicker({
  sources,
  loading,
  error,
  selected,
  disabled,
  onSelect,
  onRefresh
}: SourcePickerProps) {
  const screens = sources.filter((source) => source.kind === 'screen')
  const windows = sources.filter((source) => source.kind === 'window')

  return (
    <section className="space-y-4" aria-labelledby="sources-title">
      <div className="flex items-center justify-between">
        <h2 id="sources-title" className="text-sm font-semibold tracking-tight">
          O que gravar
        </h2>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={disabled || loading}>
          <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden />
          Atualizar
        </Button>
      </div>

      {error && (
        <p className="text-destructive text-sm">Não foi possível listar as telas: {error}</p>
      )}

      <div role="radiogroup" aria-labelledby="sources-title" className="space-y-5">
        <Group title="Telas">
          {loading && screens.length === 0
            ? [0, 1].map((key) => (
                <div key={key} className="bg-muted aspect-[16/12] animate-pulse rounded-xl" />
              ))
            : screens.map((source) => (
                <Card
                  key={source.id}
                  selected={isSameSource(selected, toRef(source))}
                  disabled={disabled}
                  onClick={() => onSelect(toRef(source))}
                  preview={<Thumbnail source={source} />}
                  title={source.name}
                  subtitle="Tela inteira"
                  icon={<Monitor className="size-4" aria-hidden />}
                />
              ))}
        </Group>

        {windows.length > 0 && (
          <Group title="Janelas">
            {windows.map((source) => (
              <Card
                key={source.id}
                selected={isSameSource(selected, toRef(source))}
                disabled={disabled}
                onClick={() => onSelect(toRef(source))}
                preview={<Thumbnail source={source} />}
                title={source.name}
                subtitle="Janela"
                icon={
                  source.appIcon ? (
                    <img src={source.appIcon} alt="" className="size-4" draggable={false} />
                  ) : (
                    <AppWindow className="size-4" aria-hidden />
                  )
                }
              />
            ))}
          </Group>
        )}

        <Group title="Sem vídeo">
          <Card
            selected={selected.kind === 'none'}
            disabled={disabled}
            onClick={() => onSelect(AUDIO_ONLY)}
            preview={
              <div className="text-muted-foreground grid h-full place-items-center">
                <Mic className="size-8" strokeWidth={1.5} aria-hidden />
              </div>
            }
            title="Nenhuma — só áudio"
            subtitle="Grava apenas o som"
            icon={<Mic className="size-4" aria-hidden />}
          />
        </Group>
      </div>
    </section>
  )
}
