import { CircleCheck, HardDrive, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDuration } from '@/lib/format'
import { WARNING_TEXT } from '@/lib/record-text'
import { cn } from '@/lib/utils'
import type { PreflightInfo, RecordingWarning, RecoveryReport } from '@shared/recording'

/** Aviso amarelo (atenção, sem bloquear). */
export function WarningNotice({
  title,
  children,
  icon = <TriangleAlert aria-hidden />,
  className
}: {
  title: string
  children?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <Alert className={cn('border-warning/40 text-warning', className)}>
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  )
}

export function RecordingWarnings({ warnings }: { warnings: RecordingWarning[] }) {
  return (
    <div className="space-y-2" aria-live="polite">
      {warnings.map((warning) => (
        <WarningNotice key={warning} title={WARNING_TEXT[warning].title}>
          {WARNING_TEXT[warning].detail}
        </WarningNotice>
      ))}
    </div>
  )
}

/** Avisos antes de gravar: pouco espaço, sem espaço e FFmpeg ausente. */
export function PreflightNotices({ info }: { info: PreflightInfo | null }) {
  if (!info) return null
  const free = info.freeBytes === null ? '' : formatBytes(info.freeBytes)
  return (
    <div className="space-y-2">
      {info.disk === 'critical' && (
        <Alert variant="destructive">
          <HardDrive aria-hidden />
          <AlertTitle>Não há espaço livre para gravar</AlertTitle>
          <AlertDescription>
            Restam {free} na pasta das Reuniões. Libere espaço para gravar.
          </AlertDescription>
        </Alert>
      )}
      {info.disk === 'low' && (
        <WarningNotice title={`Pouco espaço livre: ${free}`} icon={<HardDrive aria-hidden />}>
          Uma hora de gravação usa cerca de 1 GB (pode chegar a 2 GB).
        </WarningNotice>
      )}
      {!info.ffmpegAvailable && (
        <WarningNotice title="FFmpeg não está instalado" icon={<Info aria-hidden />}>
          Dá para gravar, mas os arquivos finais só ficam prontos depois que o FFmpeg for instalado;
          a Reunião é recuperada automaticamente ao abrir o app.
        </WarningNotice>
      )}
    </div>
  )
}

/** Resultado da recuperação de gravações interrompidas, com opção de dispensar. */
export function RecoveryBanner({
  report,
  onRetry,
  onDismiss
}: {
  report: RecoveryReport
  onRetry: () => void
  onDismiss: () => void
}) {
  const recovered = report.items.filter((item) => item.outcome === 'recovered')
  const pending = report.items.filter((item) => item.outcome === 'pending')
  const failed = report.items.filter((item) => item.outcome === 'failed')
  if (report.running || recovered.length + pending.length + failed.length === 0) return null

  return (
    <Alert className="border-primary/30">
      <CircleCheck aria-hidden />
      <AlertTitle>
        {recovered.length > 0
          ? recovered.length === 1
            ? 'Recuperamos uma gravação interrompida'
            : `Recuperamos ${recovered.length} gravações interrompidas`
          : 'Há gravações interrompidas'}
      </AlertTitle>
      <AlertDescription>
        {recovered.map((item) => (
          <p key={item.folder}>
            “{item.name}”{item.durationMs ? ` — ${formatDuration(item.durationMs)} salvos` : ''}.
          </p>
        ))}
        {pending.map((item) => (
          <p key={item.folder}>“{item.name}” aguarda o FFmpeg para ser recuperada.</p>
        ))}
        {failed.map((item) => (
          <p key={item.folder} className="text-destructive">
            “{item.name}” não pôde ser recuperada{item.reason ? `: ${item.reason}` : '.'}
          </p>
        ))}
        <div className="mt-2 flex gap-2">
          {(pending.length > 0 || failed.length > 0) && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Tentar de novo
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dispensar
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
