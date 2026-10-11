import { AppWindow, LoaderCircle, Mic, Monitor, Pause, Play, Square, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { LevelMeter } from '@/components/record/level-meter'
import { RecordingWarnings } from '@/components/record/notices'
import { Button } from '@/components/ui/button'
import { formatElapsed } from '@shared/clock'
import { useElapsedMs, useRecordingLevels } from '@/lib/recording'
import { cn } from '@/lib/utils'
import type { RecordingState } from '@shared/recording'

type ActiveState = Extract<RecordingState, { phase: 'recording' | 'paused' | 'finalizing' }>

const QUALITY_LABEL = { '720p': '720p', '1080p': '1080p', native: 'Resolução nativa' } as const

function SourceLine({ state }: { state: ActiveState }) {
  const { source, quality, videoSize } = state.meeting
  const Icon = source.kind === 'screen' ? Monitor : source.kind === 'window' ? AppWindow : Mic
  const label =
    source.kind === 'none'
      ? 'Só áudio'
      : `${source.kind === 'screen' ? 'Tela' : 'Janela'} — ${source.name ?? ''}`
  return (
    <div className="text-muted-foreground flex max-w-full items-center justify-center gap-2 text-sm">
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate" title={label}>
        {label}
      </span>
      {videoSize && (
        <span className="shrink-0">
          · {QUALITY_LABEL[quality]} ({videoSize.width}×{videoSize.height})
        </span>
      )}
    </div>
  )
}

function MeterRow({
  icon,
  label,
  level,
  note
}: {
  icon: React.ReactNode
  label: string
  level: number
  note?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="w-28 shrink-0 text-sm">{label}</span>
      {note ? (
        <span className="text-muted-foreground text-xs">{note}</span>
      ) : (
        <LevelMeter level={level} label={`Nível de ${label.toLowerCase()}`} />
      )}
    </div>
  )
}

/** Painel durante a gravação: tempo, pausa/retomada, parar, níveis e avisos. */
export function ActivePanel({ state }: { state: ActiveState }) {
  const [busy, setBusy] = useState(false)
  const finalizing = state.phase === 'finalizing'
  const paused = state.phase === 'paused'
  const elapsed = useElapsedMs(state.clock)
  const levels = useRecordingLevels(state.phase === 'recording')

  const run = async (channel: 'recording:pause' | 'recording:resume' | 'recording:stop') => {
    setBusy(true)
    try {
      await window.api.invoke(channel)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-8 px-8 py-14">
      <div className="space-y-4 text-center">
        <div
          className={cn(
            'mx-auto inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium',
            finalizing
              ? 'bg-muted text-muted-foreground'
              : paused
                ? 'bg-warning/15 text-warning'
                : 'bg-record/10 text-record'
          )}
        >
          {finalizing ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <span
              aria-hidden
              className={cn(
                'size-2.5 rounded-full',
                paused ? 'bg-warning' : 'bg-record animate-pulse'
              )}
            />
          )}
          {finalizing ? 'Finalizando…' : paused ? 'Pausada' : 'Gravando'}
        </div>
        <div
          className="text-6xl font-semibold tracking-tight tabular-nums"
          role="timer"
          aria-label="Tempo gravado"
        >
          {formatElapsed(elapsed)}
        </div>
        <SourceLine state={state} />
      </div>

      {finalizing ? (
        <p className="text-muted-foreground text-center text-sm">
          Salvando os arquivos da Reunião. Isso leva só alguns segundos.
        </p>
      ) : (
        <>
          <div className="bg-card border-border w-full space-y-3.5 rounded-xl border px-5 py-4">
            <MeterRow
              icon={<Mic className="size-4" aria-hidden />}
              label="Microfone"
              level={levels.mic}
              {...(!state.meeting.hasMic ? { note: 'Não está sendo gravado' } : {})}
            />
            <MeterRow
              icon={<Volume2 className="size-4" aria-hidden />}
              label="Áudio do sistema"
              level={levels.system}
              {...(!state.meeting.hasSystemAudio ? { note: 'Indisponível' } : {})}
            />
          </div>

          {state.phase !== 'recording' && state.phase !== 'paused' ? null : (
            <div className="w-full">
              <RecordingWarnings warnings={state.warnings} />
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="lg"
              variant="outline"
              disabled={busy}
              onClick={() => void run(paused ? 'recording:resume' : 'recording:pause')}
            >
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              {paused ? 'Retomar' : 'Pausar'}
            </Button>
            <Button
              size="lg"
              disabled={busy}
              className="bg-record hover:bg-record/90 text-white"
              onClick={() => void run('recording:stop')}
            >
              <Square className="fill-current" aria-hidden />
              Parar e salvar
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
