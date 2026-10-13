import { LoaderCircle, ScrollText, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useAiStatus } from '@/lib/ai'
import { TranscriptList } from '@/components/meeting/transcript-list'
import type { PlayerController } from '@/lib/player-controller'
import { useTranscriptActions, useTranscriptData, type TranscriptActions } from '@/lib/transcript'
import { alternativeModel } from '@shared/ai'
import type { TranscriptView } from '@shared/transcript'

interface TranscriptTabProps {
  folder: string
  /** A Reunião ainda está sendo gravada ou processada. */
  locked: boolean
  hasAudioFile: boolean
  view: TranscriptView
  controller: PlayerController
}

export function TranscriptTab({
  folder,
  locked,
  hasAudioFile,
  view,
  controller
}: TranscriptTabProps) {
  const { data, replace } = useTranscriptData(folder, view)
  const actions = useTranscriptActions(folder)
  const ai = useAiStatus()
  const hasKey = ai.status?.keys.gemini.configured ?? true

  if (view.status === 'running') return <RunningView view={view} onCancel={actions.cancel} />
  if (view.status === 'error') {
    return <ErrorView view={view} hasKey={hasKey} actions={actions} />
  }
  if (view.status === 'ready') {
    if (data.status === 'ready') {
      return (
        <TranscriptList
          folder={folder}
          transcript={data.transcript}
          controller={controller}
          actions={actions}
          summaryRequested={view.summaryRequested}
          onReplace={replace}
        />
      )
    }
    if (data.status === 'error') {
      return (
        <EmptyState
          icon={TriangleAlert}
          title="Não foi possível abrir a Transcrição"
          description={data.error}
          action={<GenerateButton label="Gerar de novo" actions={actions} variant="outline" />}
        />
      )
    }
    return (
      <div className="text-muted-foreground grid h-full place-items-center">
        <LoaderCircle className="size-5 animate-spin" aria-label="Carregando a Transcrição" />
      </div>
    )
  }

  const unavailable = locked
    ? 'Disponível quando a Reunião terminar de ser gravada.'
    : !hasAudioFile
      ? 'Esta Reunião não tem o Áudio da reunião para transcrever.'
      : null
  return (
    <EmptyState
      icon={ScrollText}
      title="A Transcrição ainda não foi gerada"
      description={
        unavailable ??
        'Ela mostra as falas de cada Falante, cada uma com o Instante em que foi dita. O áudio é enviado ao Gemini com a sua chave.'
      }
      action={
        unavailable ? undefined : hasKey ? (
          <GenerateButton label="Gerar Transcrição" actions={actions} />
        ) : (
          <Button asChild>
            <a href="#/settings">Configurar a chave do Gemini</a>
          </Button>
        )
      }
    />
  )
}

function GenerateButton({
  label,
  actions,
  variant = 'default',
  summaryRequested = false,
  model
}: {
  label: string
  actions: TranscriptActions
  variant?: 'default' | 'outline'
  summaryRequested?: boolean
  /** Modelo só desta tentativa. */
  model?: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const run = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    const failure = await actions.start(summaryRequested, model)
    setStarting(false)
    if (failure) setError(failure)
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant={variant} disabled={starting} onClick={() => void run()}>
        {starting && <LoaderCircle className="animate-spin" aria-hidden />}
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-destructive max-w-xs text-center text-xs">
          {error}
        </p>
      )}
    </div>
  )
}

function RunningView({ view, onCancel }: { view: TranscriptView; onCancel: () => void }) {
  const known = view.total > 0
  const percent = known ? Math.round((view.done / view.total) * 100) : 0
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 py-12 text-center">
      <LoaderCircle className="text-primary size-8 animate-spin" aria-hidden />
      <div className="w-full max-w-xs space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Transcrevendo…</h2>
        <Progress value={percent} aria-label="Andamento da Transcrição" />
        <p className="text-muted-foreground text-sm" role="status">
          {known && view.total > 1
            ? `${view.done} de ${view.total} blocos prontos`
            : 'Isso leva alguns minutos.'}
        </p>
        <p className="text-muted-foreground text-xs text-balance">
          Você pode abrir outras telas: a Transcrição continua em segundo plano.
        </p>
      </div>
      <Button variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  )
}

function ErrorView({
  view,
  hasKey,
  actions
}: {
  view: TranscriptView
  hasKey: boolean
  actions: TranscriptActions
}) {
  const alternative = alternativeModel(view.model)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 py-10">
      <Alert variant="destructive" className="max-w-md">
        <TriangleAlert aria-hidden />
        <AlertTitle>A Transcrição não foi concluída</AlertTitle>
        <AlertDescription>{view.error ?? 'Ocorreu um erro inesperado.'}</AlertDescription>
      </Alert>
      {hasKey ? (
        <div className="flex flex-wrap justify-center gap-2">
          <GenerateButton
            label="Tentar de novo"
            actions={actions}
            summaryRequested={view.summaryRequested}
          />
          <GenerateButton
            label={`Tentar com o ${alternative.label}`}
            variant="outline"
            actions={actions}
            summaryRequested={view.summaryRequested}
            model={alternative.id}
          />
        </div>
      ) : (
        <Button asChild>
          <a href="#/settings">Configurar a chave do Gemini</a>
        </Button>
      )}
    </div>
  )
}
