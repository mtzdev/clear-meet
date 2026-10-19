import { FolderOpen, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/lib/format'
import {
  describeRelocation,
  moveQuestion,
  relocationPercent,
  type RelocationReport
} from '@/lib/relocation'
import type { MeetingsDirChoice, RelocationProgress } from '@shared/relocation'

type Phase =
  | { kind: 'idle' }
  | { kind: 'choosing' }
  | { kind: 'confirm'; choice: MeetingsDirChoice }
  | { kind: 'moving'; progress: RelocationProgress | null }
  | { kind: 'done'; report: RelocationReport }

interface ChangeFolderButtonProps {
  label?: string
  /** A pasta das Reuniões mudou (ou a troca terminou): quem mostra o caminho deve relê-lo. */
  onChanged: () => void
  disabled?: boolean
}

/**
 * Botão que troca a pasta das Reuniões: abre o seletor, pergunta se as Reuniões existentes vão
 * junto, mostra o andamento e, no fim, o que aconteceu.
 */
export function ChangeFolderButton({
  label = 'Alterar…',
  onChanged,
  disabled
}: ChangeFolderButtonProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      window.api.on('meetingsDir:progress', (progress) =>
        setPhase((current) => (current.kind === 'moving' ? { kind: 'moving', progress } : current))
      ),
    []
  )

  const apply = async (newDir: string, move: boolean): Promise<void> => {
    setError(null)
    setPhase({ kind: 'moving', progress: null })
    try {
      const result = await window.api.invoke('meetingsDir:apply', { newDir, move })
      if (!result.ok) {
        setPhase({ kind: 'idle' })
        setError(result.error.message)
        return
      }
      onChanged()
      setPhase({ kind: 'done', report: describeRelocation(result.value) })
    } catch (failure) {
      setPhase({ kind: 'idle' })
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const choose = async (): Promise<void> => {
    setError(null)
    setPhase({ kind: 'choosing' })
    try {
      const result = await window.api.invoke('meetingsDir:choose')
      if (!result.ok) {
        setPhase({ kind: 'idle' })
        setError(result.error.message)
        return
      }
      const choice = result.value
      if (choice === null) {
        setPhase({ kind: 'idle' })
        return
      }
      if (choice.meetingCount === 0) {
        await apply(choice.newDir, false)
        return
      }
      setPhase({ kind: 'confirm', choice })
    } catch (failure) {
      setPhase({ kind: 'idle' })
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const close = (): void => setPhase({ kind: 'idle' })
  const busy = phase.kind === 'choosing' || phase.kind === 'moving'

  return (
    <>
      <div className="flex flex-col items-end gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          onClick={() => void choose()}
        >
          {phase.kind === 'choosing' && <LoaderCircle className="animate-spin" aria-hidden />}
          {label}
        </Button>
        {error && (
          <p role="alert" className="text-destructive max-w-72 text-right text-xs">
            {error}
          </p>
        )}
      </div>

      <AlertDialog
        open={phase.kind === 'confirm'}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {phase.kind === 'confirm'
                ? moveQuestion(phase.choice.meetingCount, phase.choice.totalBytes)
                : ''}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="break-all">
                  Nova pasta:{' '}
                  <span className="text-foreground font-mono text-xs">
                    {phase.kind === 'confirm' ? phase.choice.newDir : ''}
                  </span>
                </p>
                <p>
                  Com &ldquo;Só trocar a pasta&rdquo;, as Reuniões atuais ficam onde estão e deixam
                  de aparecer na lista.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => phase.kind === 'confirm' && void apply(phase.choice.newDir, false)}
            >
              Só trocar a pasta
            </Button>
            <Button
              onClick={() => phase.kind === 'confirm' && void apply(phase.choice.newDir, true)}
            >
              Mover
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={phase.kind === 'moving'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Movendo as Reuniões…</AlertDialogTitle>
            <AlertDialogDescription>
              Não feche o ClearMeet até terminar. Pode levar alguns minutos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <MovingProgress progress={phase.kind === 'moving' ? phase.progress : null} />
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => void window.api.invoke('meetingsDir:cancel')}>
              Parar depois desta Reunião
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={phase.kind === 'done'}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{phase.kind === 'done' ? phase.report.title : ''}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {phase.kind === 'done' &&
                  phase.report.lines.map((line, index) => (
                    <p key={index} className="break-words">
                      {line}
                    </p>
                  ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {phase.kind === 'done' && phase.report.showPreviousDir && (
              <Button
                variant="outline"
                onClick={() => void window.api.invoke('meetingsDir:open', { which: 'previous' })}
              >
                <FolderOpen aria-hidden />
                Abrir pasta antiga
              </Button>
            )}
            <AlertDialogCancel>Fechar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MovingProgress({ progress }: { progress: RelocationProgress | null }) {
  if (!progress) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Preparando…
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <Progress value={relocationPercent(progress)} aria-label="Andamento da mudança de pasta" />
      <p className="text-muted-foreground text-sm" role="status">
        Reunião {progress.current} de {progress.total} · {formatBytes(progress.bytesDone)} de{' '}
        {formatBytes(progress.bytesTotal)}
      </p>
      <p className="text-muted-foreground truncate text-xs" title={progress.name}>
        {progress.name}
      </p>
    </div>
  )
}
