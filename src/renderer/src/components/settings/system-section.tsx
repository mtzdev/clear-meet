import { CircleCheck, Download, LoaderCircle, TriangleAlert } from 'lucide-react'
import { InstallProgress } from '@/components/settings/install-progress'
import { Path, Row } from '@/components/settings/layout'
import { Button } from '@/components/ui/button'
import { useFfmpegInstall } from '@/lib/ffmpeg-install'
import { useIpcQuery } from '@/lib/ipc'
import { isFfmpegInstalling, type FfmpegSource, type FfmpegStatus } from '@shared/ffmpeg'
import { useEffect } from 'react'

const SOURCE_LABEL: Record<FfmpegSource, string> = {
  env: 'Variável FFMPEG_PATH',
  downloaded: 'Baixado pelo app',
  vendor: 'Pasta vendor (desenvolvimento)'
}

function FfmpegBadge({ status }: { status: FfmpegStatus }) {
  if (status.available) {
    return (
      <span className="text-success inline-flex items-center gap-1.5 font-medium">
        <CircleCheck className="size-4" aria-hidden /> Disponível
      </span>
    )
  }
  return (
    <span className="text-warning inline-flex items-center gap-1.5 font-medium">
      <TriangleAlert className="size-4" aria-hidden />
      {status.source ? 'Com problema' : 'Não instalado'}
    </span>
  )
}

/** Baixa (ou baixa de novo) o FFmpeg quando ele não está utilizável. */
function InstallRow({ status, onInstalled }: { status: FfmpegStatus; onInstalled: () => void }) {
  const { state, start } = useFfmpegInstall()
  const installing = isFfmpegInstalling(state)

  useEffect(() => {
    if (state.phase === 'done') onInstalled()
  }, [state.phase, onInstalled])

  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {status.source ? 'Reinstalar o FFmpeg' : 'Instalar o FFmpeg'}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Sem ele não é possível gravar nem transcrever.
          </p>
        </div>
        <Button disabled={installing} onClick={start}>
          {installing ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}
          {state.phase === 'error' ? 'Tentar de novo' : status.source ? 'Reinstalar' : 'Baixar'}
        </Button>
      </div>
      {state.phase !== 'idle' && state.phase !== 'done' && <InstallProgress state={state} />}
    </div>
  )
}

export function FfmpegRows() {
  const query = useIpcQuery('ffmpeg:status')

  if (query.status === 'loading') {
    return (
      <Row label="FFmpeg">
        <span className="text-muted-foreground inline-flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Verificando…
        </span>
      </Row>
    )
  }
  if (query.status === 'error') {
    return (
      <Row label="FFmpeg" hint="Não foi possível verificar.">
        <span className="text-destructive">{query.error}</span>
      </Row>
    )
  }

  const status = query.data
  return (
    <>
      <Row label="FFmpeg" hint="Usado para compactar vídeos e preparar o áudio para a Transcrição.">
        <FfmpegBadge status={status} />
      </Row>
      {status.error && (
        <Row label="Detalhe">
          <span className="text-muted-foreground">{status.error}</span>
        </Row>
      )}
      {status.version && (
        <Row label="Versão">
          <span className="font-mono text-xs">{status.version}</span>
        </Row>
      )}
      <Row
        label="Encoder AV1 (libsvtav1)"
        hint="Compactação por CPU quando não há AV1 por hardware."
      >
        {status.available ? (
          <span className={status.hasLibSvtAv1 ? 'text-success' : 'text-warning'}>
            {status.hasLibSvtAv1 ? 'Presente' : 'Ausente'}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </Row>
      {status.source && <Row label="Origem">{SOURCE_LABEL[status.source]}</Row>}
      <Row label="Local">
        <Path value={status.ffmpegPath} />
      </Row>
      {!status.available && <InstallRow status={status} onInstalled={query.reload} />}
    </>
  )
}

export function VersionRow() {
  const query = useIpcQuery('app:getVersion')
  return (
    <Row label="Versão do ClearMeet">
      {query.status === 'ready' ? (
        <span className="font-mono text-xs">{query.data}</span>
      ) : (
        <span className="text-muted-foreground">-</span>
      )}
    </Row>
  )
}
