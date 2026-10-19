import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { canRestartForUpdate } from '@shared/update'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useRecordingState } from '@/lib/recording'
import { useUpdateState } from '@/lib/update'

/** Aviso discreto no canto da janela quando uma atualização já foi baixada. */
export function UpdateBanner() {
  const update = useUpdateState()
  const recording = useRecordingState().phase
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  if (update.phase !== 'ready' || update.version === dismissedVersion) return null

  const canRestart = canRestartForUpdate(recording)
  const restart = (): void => {
    setFailed(false)
    void window.api.invoke('update:restart').then((result) => {
      if (!result.ok) setFailed(true)
    })
  }

  return (
    <div
      role="status"
      className="bg-card text-card-foreground fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border py-2.5 pr-2 pl-3.5 text-sm shadow-lg"
    >
      <RefreshCw className="text-primary size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Atualização pronta</p>
        <p className="text-muted-foreground text-xs">
          {failed ? 'Não foi possível reiniciar agora.' : `Versão ${update.version}`}
        </p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={canRestart ? undefined : 0}>
            <Button size="sm" disabled={!canRestart} onClick={restart}>
              Reiniciar agora
            </Button>
          </span>
        </TooltipTrigger>
        {!canRestart && (
          <TooltipContent side="top">Disponível depois de terminar a gravação</TooltipContent>
        )}
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dispensar aviso"
        onClick={() => setDismissedVersion(update.version)}
      >
        <X />
      </Button>
    </div>
  )
}
