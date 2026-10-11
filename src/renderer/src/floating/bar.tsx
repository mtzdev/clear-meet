import {
  AppWindow,
  CircleCheck,
  MicOff,
  NotebookPen,
  Pause,
  Play,
  Square,
  TriangleAlert
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { LevelMeter } from '@/components/record/level-meter'
import { useElapsedMs, useRecordingLevels, useRecordingState } from '@/lib/recording'
import { WARNING_SHORT, WARNING_TEXT } from '@/lib/record-text'
import { cn } from '@/lib/utils'
import { formatElapsed } from '@shared/clock'
import type { RecordingWarning } from '@shared/recording'
import { useFloatingInfo, useNoteSavedToast, useReportHeight } from './hooks'

function BarButton({
  label,
  onClick,
  disabled,
  className,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'app-no-drag text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex size-8 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] disabled:opacity-50 [&_svg]:size-4',
        className
      )}
    >
      {children}
    </button>
  )
}

function StatusLine({
  tone,
  icon,
  children,
  title
}: {
  tone: 'warning' | 'success'
  icon: ReactNode
  children: ReactNode
  title?: string
}) {
  return (
    <div
      title={title}
      className={cn(
        'bg-card border-border flex items-start gap-1.5 rounded-xl border px-3 py-1.5 text-xs leading-snug shadow-md',
        tone === 'warning' ? 'text-warning' : 'text-success'
      )}
    >
      <span className="mt-px shrink-0 [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/**
 * Barra flutuante da gravação: `● tempo | nível do mic | avisos | anotar | pausar | parar`.
 * A janela principal fica oculta durante a gravação; aqui aparecem também os avisos ativos
 * (janela minimizada, vídeo parou, disco, microfone) e o aviso de atalho indisponível.
 */
export function FloatingBar() {
  const state = useRecordingState()
  const info = useFloatingInfo()
  const savedAt = useNoteSavedToast()
  const rootRef = useRef<HTMLDivElement>(null)
  useReportHeight(rootRef)

  const active = state.phase === 'recording' || state.phase === 'paused' ? state : null
  const paused = active?.phase === 'paused'
  const elapsed = useElapsedMs(active?.clock ?? null)
  const levels = useRecordingLevels(active?.phase === 'recording')
  const [busy, setBusy] = useState(false)

  const run = async (channel: 'recording:pause' | 'recording:resume' | 'recording:stop') => {
    setBusy(true)
    try {
      await window.api.invoke(channel)
    } catch {
      // A janela some junto com a gravação; nada a mostrar.
    } finally {
      setBusy(false)
    }
  }

  const warnings: RecordingWarning[] = active?.warnings ?? []

  return (
    <div ref={rootRef} className="flex w-full flex-col gap-1 p-1">
      <div
        className="app-drag bg-card text-card-foreground border-border flex h-11 items-center gap-2.5 rounded-full border pr-1.5 pl-4 shadow-lg"
        role="toolbar"
        aria-label="Gravação em andamento"
      >
        <span
          aria-hidden
          className={cn(
            'size-2.5 shrink-0 rounded-full',
            paused ? 'bg-warning' : 'bg-record animate-pulse'
          )}
        />
        <span
          className="w-[3.6rem] shrink-0 text-sm font-semibold tabular-nums"
          role="timer"
          aria-label="Tempo gravado"
        >
          {formatElapsed(elapsed)}
        </span>

        <div className="flex w-14 shrink-0 items-center" title="Nível do microfone">
          {active && !active.meeting.hasMic ? (
            <MicOff className="text-muted-foreground size-4" aria-label="Microfone não gravado" />
          ) : (
            <LevelMeter level={levels.mic} label="Nível do microfone" />
          )}
        </div>

        <div className="min-w-0 flex-1" />

        {warnings.length > 0 && (
          <span
            className="text-warning flex size-6 shrink-0 items-center justify-center"
            title={warnings.map((warning) => WARNING_TEXT[warning].title).join('\n')}
          >
            <TriangleAlert className="size-4" aria-label="Há avisos sobre a gravação" />
          </span>
        )}

        <BarButton
          label={`Anotar (${info.shortcut})`}
          onClick={() => void window.api.invoke('notes:openEditor')}
        >
          <NotebookPen aria-hidden />
        </BarButton>
        <BarButton
          label={paused ? 'Retomar a gravação' : 'Pausar a gravação'}
          disabled={busy || !active}
          onClick={() => void run(paused ? 'recording:resume' : 'recording:pause')}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        </BarButton>
        <BarButton
          label="Parar e salvar"
          disabled={busy || !active}
          className="bg-record hover:bg-record/90 hover:text-white text-white"
          onClick={() => void run('recording:stop')}
        >
          <Square className="fill-current" aria-hidden />
        </BarButton>
        <BarButton
          label="Abrir a janela do ClearMeet"
          onClick={() => void window.api.invoke('floating:showMain')}
          className="text-muted-foreground"
        >
          <AppWindow aria-hidden />
        </BarButton>
      </div>

      {savedAt !== null && (
        <StatusLine tone="success" icon={<CircleCheck aria-hidden />}>
          Anotação salva · {formatElapsed(savedAt)}
        </StatusLine>
      )}
      {!info.shortcutRegistered && (
        <StatusLine tone="warning" icon={<TriangleAlert aria-hidden />}>
          Atalho {info.shortcut} indisponível (em uso por outro app). Use o botão de anotar.
        </StatusLine>
      )}
      {warnings.map((warning) => (
        <StatusLine
          key={warning}
          tone="warning"
          icon={<TriangleAlert aria-hidden />}
          title={WARNING_TEXT[warning].detail}
        >
          {WARNING_SHORT[warning]}
        </StatusLine>
      ))}
    </div>
  )
}
