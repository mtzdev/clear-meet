import { Check, Copy, LoaderCircle, ScrollText, Sparkles, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { EmptyState } from '@/components/empty-state'
import { InstantLink } from '@/components/meeting/instant-link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAiStatus } from '@/lib/ai'
import type { PlayerController } from '@/lib/player-controller'
import { useSummaryActions, useSummaryData, type SummaryActions } from '@/lib/summary'
import { useTranscriptActions } from '@/lib/transcript'
import { AI_PROVIDER_LABEL } from '@shared/ai'
import {
  summaryToText,
  type SummaryAction,
  type SummaryFile,
  type SummaryItem,
  type SummaryView
} from '@shared/summary'
import type { TranscriptView } from '@shared/transcript'

interface SummaryTabProps {
  folder: string
  meetingName: string
  /** A Reunião ainda está sendo gravada ou processada. */
  locked: boolean
  hasAudioFile: boolean
  view: SummaryView
  transcript: TranscriptView
  controller: PlayerController
}

export function SummaryTab({
  folder,
  meetingName,
  locked,
  hasAudioFile,
  view,
  transcript,
  controller
}: SummaryTabProps) {
  const data = useSummaryData(folder, view)
  const actions = useSummaryActions(folder)
  const transcriptActions = useTranscriptActions(folder)
  const ai = useAiStatus()
  const hasTextKey = ai.status
    ? ai.status.keys.gemini.configured || ai.status.keys.groq.configured
    : true
  const hasGeminiKey = ai.status?.keys.gemini.configured ?? true

  if (view.status === 'running') return <RunningView onCancel={actions.cancel} />

  if (view.status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 px-6 py-10">
        <Alert variant="destructive" className="max-w-md">
          <TriangleAlert aria-hidden />
          <AlertTitle>O Resumo não foi gerado</AlertTitle>
          <AlertDescription>{view.error ?? 'Ocorreu um erro inesperado.'}</AlertDescription>
        </Alert>
        {transcript.status === 'ready' && hasTextKey ? (
          <GenerateButton label="Tentar de novo" actions={actions} />
        ) : transcript.status === 'ready' ? (
          <KeyLink />
        ) : null}
      </div>
    )
  }

  if (view.status === 'ready') {
    if (data.status === 'ready') {
      return (
        <SummaryContent
          summary={data.summary}
          meetingName={meetingName}
          actions={actions}
          canRedo={transcript.status === 'ready' && hasTextKey}
          onSeek={(ms) => controller.seekToMs(ms)}
        />
      )
    }
    if (data.status === 'error') {
      return (
        <EmptyState
          icon={TriangleAlert}
          title="Não foi possível abrir o Resumo"
          description={data.error}
          action={
            transcript.status === 'ready' && hasTextKey ? (
              <GenerateButton label="Gerar de novo" actions={actions} variant="outline" />
            ) : undefined
          }
        />
      )
    }
    return (
      <div className="text-muted-foreground grid h-full place-items-center">
        <LoaderCircle className="size-5 animate-spin" aria-label="Carregando o Resumo" />
      </div>
    )
  }

  // Sem Resumo ainda.
  if (transcript.status === 'running') {
    return (
      <EmptyState
        icon={Sparkles}
        title="Aguardando a Transcrição"
        description={
          transcript.summaryRequested
            ? 'O Resumo é gerado sozinho assim que a Transcrição terminar.'
            : 'Quando a Transcrição terminar, gere o Resumo por aqui.'
        }
      />
    )
  }
  if (transcript.status !== 'ready') {
    const unavailable = locked
      ? 'Disponível quando a Reunião terminar de ser gravada.'
      : !hasAudioFile
        ? 'Esta Reunião não tem o Áudio da reunião para transcrever.'
        : null
    return (
      <EmptyState
        icon={ScrollText}
        title="O Resumo precisa da Transcrição"
        description={unavailable ?? 'Gere a Transcrição primeiro; o Resumo é feito a partir dela.'}
        action={
          unavailable ? undefined : hasGeminiKey ? (
            <TranscribeButton actions={transcriptActions} />
          ) : (
            <Button asChild>
              <a href="#/settings">Configurar a chave do Gemini</a>
            </Button>
          )
        }
      />
    )
  }
  return (
    <EmptyState
      icon={Sparkles}
      title="O Resumo ainda não foi gerado"
      description="Pontos principais, decisões e quem faz o quê. A Transcrição é enviada à IA com a sua chave."
      action={hasTextKey ? <GenerateButton label="Gerar Resumo" actions={actions} /> : <KeyLink />}
    />
  )
}

function KeyLink() {
  return (
    <Button asChild>
      <a href="#/settings">Configurar uma chave de IA</a>
    </Button>
  )
}

function useStarter(run: () => Promise<string | null>) {
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const start = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    const failure = await run()
    setStarting(false)
    if (failure) setError(failure)
  }
  return { error, starting, start }
}

function StarterButton({
  label,
  variant = 'default',
  starter
}: {
  label: string
  variant?: 'default' | 'outline'
  starter: ReturnType<typeof useStarter>
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant={variant} disabled={starter.starting} onClick={() => void starter.start()}>
        {starter.starting && <LoaderCircle className="animate-spin" aria-hidden />}
        {label}
      </Button>
      {starter.error && (
        <p role="alert" className="text-destructive max-w-xs text-center text-xs">
          {starter.error}
        </p>
      )}
    </div>
  )
}

function GenerateButton({
  label,
  actions,
  variant = 'default'
}: {
  label: string
  actions: SummaryActions
  variant?: 'default' | 'outline'
}) {
  const starter = useStarter(actions.start)
  return <StarterButton label={label} variant={variant} starter={starter} />
}

function TranscribeButton({ actions }: { actions: ReturnType<typeof useTranscriptActions> }) {
  const starter = useStarter(() => actions.start(true))
  return <StarterButton label="Transcrever e resumir" starter={starter} />
}

function RunningView({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 py-12 text-center">
      <LoaderCircle className="text-primary size-8 animate-spin" aria-hidden />
      <div className="max-w-xs space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Resumindo…</h2>
        <p className="text-muted-foreground text-sm" role="status">
          Isso leva alguns segundos.
        </p>
        <p className="text-muted-foreground text-xs text-balance">
          Você pode abrir outras telas: o Resumo continua em segundo plano.
        </p>
      </div>
      <Button variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="text-muted-foreground text-sm">{children}</p>
}

function Citations({ at, onSeek }: { at: readonly number[]; onSeek: (ms: number) => void }) {
  return (
    <>
      {at.map((ms) => (
        <InstantLink key={ms} ms={ms} onSeek={onSeek} />
      ))}
    </>
  )
}

function ItemList({
  items,
  empty,
  onSeek
}: {
  items: readonly SummaryItem[]
  empty: string
  onSeek: (ms: number) => void
}) {
  if (items.length === 0) return <Empty>{empty}</Empty>
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
      {items.map((item, index) => (
        <li key={index}>
          {item.text} <Citations at={item.at} onSeek={onSeek} />
        </li>
      ))}
    </ul>
  )
}

function ActionList({
  actions,
  onSeek
}: {
  actions: readonly SummaryAction[]
  onSeek: (ms: number) => void
}) {
  if (actions.length === 0) return <Empty>Nenhuma ação registrada.</Empty>
  return (
    <ul className="space-y-2">
      {actions.map((action, index) => (
        <li
          key={index}
          className="border-border bg-card space-y-0.5 rounded-lg border px-3 py-2 text-sm"
        >
          <p className="font-medium">{action.owner ?? 'Sem responsável definido'}</p>
          <p className="leading-relaxed">
            {action.task} <Citations at={action.at} onSeek={onSeek} />
          </p>
          {action.due && <p className="text-muted-foreground text-xs">Prazo: {action.due}</p>}
        </li>
      ))}
    </ul>
  )
}

function CopyButtons({ summary, name }: { summary: SummaryFile; name: string }) {
  const [copied, setCopied] = useState<'text' | 'markdown' | 'failed' | null>(null)
  const copy = async (markdown: boolean): Promise<void> => {
    try {
      await navigator.clipboard.writeText(summaryToText(summary, name, { markdown }))
      setCopied(markdown ? 'markdown' : 'text')
    } catch {
      setCopied('failed')
    }
    window.setTimeout(() => setCopied(null), 2500)
  }
  return (
    <span className="flex items-center gap-1">
      <Button size="xs" variant="ghost" onClick={() => void copy(false)}>
        {copied === 'text' ? <Check aria-hidden /> : <Copy aria-hidden />}
        Copiar texto
      </Button>
      <Button size="xs" variant="ghost" onClick={() => void copy(true)}>
        {copied === 'markdown' ? <Check aria-hidden /> : <Copy aria-hidden />}
        Copiar Markdown
      </Button>
      {copied === 'failed' && (
        <span role="alert" className="text-destructive text-xs">
          Não foi possível copiar.
        </span>
      )}
    </span>
  )
}

function SummaryContent({
  summary,
  meetingName,
  actions,
  canRedo,
  onSeek
}: {
  summary: SummaryFile
  meetingName: string
  actions: SummaryActions
  canRedo: boolean
  onSeek: (ms: number) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generated = new Date(summary.createdAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border shrink-0 space-y-1 border-b px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CopyButtons summary={summary} name={meetingName} />
          {canRedo &&
            (confirming ? (
              <span className="flex flex-wrap items-center justify-end gap-1 text-xs">
                <span className="text-muted-foreground">Substituir o Resumo atual?</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setConfirming(false)
                    void actions.start().then(setError)
                  }}
                >
                  Gerar de novo
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
              </span>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>
                Gerar de novo
              </Button>
            ))}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <Section title="Visão geral">
          <p className="text-sm leading-relaxed">{summary.overview || 'Sem visão geral.'}</p>
        </Section>
        <Section title="Pontos principais">
          <ItemList items={summary.keyPoints} empty="Nenhum ponto registrado." onSeek={onSeek} />
        </Section>
        <Section title="Decisões">
          <ItemList items={summary.decisions} empty="Nenhuma decisão registrada." onSeek={onSeek} />
        </Section>
        <Section title="Quem faz o quê">
          <ActionList actions={summary.actions} onSeek={onSeek} />
        </Section>
        <p className="text-muted-foreground text-xs">
          Gerado pelo {AI_PROVIDER_LABEL[summary.provider]} ({summary.model}) em {generated}.
        </p>
      </div>
    </div>
  )
}
