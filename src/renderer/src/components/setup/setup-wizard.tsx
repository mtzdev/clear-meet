import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CircleCheck,
  FolderOpen,
  LoaderCircle
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ChangeFolderButton } from '@/components/settings/change-folder'
import { InstallProgress } from '@/components/settings/install-progress'
import { KeyField } from '@/components/settings/key-field'
import { Path } from '@/components/settings/layout'
import { Button } from '@/components/ui/button'
import { useAiStatus } from '@/lib/ai'
import { useFfmpegSetup } from '@/lib/ffmpeg-install'
import { useSettings } from '@/lib/recording'
import { cn } from '@/lib/utils'
import type { AiStatus } from '@shared/ai'

const STEPS = ['Gravador', 'Pasta', 'IA'] as const

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Passos da configuração">
      {STEPS.map((label, index) => {
        const done = index < current
        const active = index === current
        return (
          <li
            key={label}
            aria-current={active ? 'step' : undefined}
            className="flex flex-1 items-center gap-2"
          >
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium',
                done && 'bg-primary text-primary-foreground',
                active && 'border-primary text-primary border-2',
                !done && !active && 'border-border text-muted-foreground border'
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
            </span>
            <span className={cn('text-sm', active ? 'font-medium' : 'text-muted-foreground')}>
              {label}
            </span>
            {index < STEPS.length - 1 && <span aria-hidden className="bg-border h-px flex-1" />}
          </li>
        )
      })}
    </ol>
  )
}

function StepBody({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </div>
  )
}

function FfmpegStep({ setup }: { setup: ReturnType<typeof useFfmpegSetup> }) {
  return (
    <StepBody
      title="Preparar o gravador"
      description="Para gravar e preparar o áudio, o ClearMeet usa um componente de mídia (FFmpeg). Ele é baixado uma única vez."
    >
      <div className="bg-card border-border rounded-xl border p-5">
        {setup.ready ? (
          <p className="text-success flex items-center gap-2 text-sm font-medium">
            <CircleCheck className="size-4" aria-hidden /> Tudo pronto: o FFmpeg está instalado.
          </p>
        ) : setup.install.phase === 'error' ? (
          <div className="space-y-4">
            <InstallProgress state={setup.install} />
            <Button onClick={setup.retry}>Tentar de novo</Button>
          </div>
        ) : setup.install.phase === 'idle' || setup.checking ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Verificando…
          </p>
        ) : (
          <InstallProgress state={setup.install} />
        )}
      </div>
    </StepBody>
  )
}

function FolderStep() {
  const { settings, reload } = useSettings()
  return (
    <StepBody
      title="Pasta das Reuniões"
      description="Cada Reunião fica numa pasta própria, com o vídeo, o áudio, a Transcrição e as Anotações. Você pode mudar isso depois nas Configurações."
    >
      <div className="bg-card border-border flex items-center justify-between gap-4 rounded-xl border p-5">
        <div className="min-w-0">
          <Path value={settings?.resolvedMeetingsDir ?? null} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ChangeFolderButton label="Escolher outra…" onChanged={reload} disabled={!settings} />
          <Button
            variant="outline"
            size="sm"
            disabled={!settings}
            onClick={() => void window.api.invoke('meetingsDir:open', { which: 'current' })}
          >
            <FolderOpen aria-hidden />
            Abrir
          </Button>
        </div>
      </div>
    </StepBody>
  )
}

function AiStep({ status, onStatus }: { status: AiStatus; onStatus: (status: AiStatus) => void }) {
  return (
    <StepBody
      title="Chaves de IA"
      description="A Transcrição usa o Gemini; o Resumo e a Conversa usam a Groq, se houver chave, ou o Gemini. As chaves ficam cifradas neste computador."
    >
      <div className="bg-card divide-border border-border divide-y rounded-xl border">
        <KeyField
          provider="gemini"
          title="Chave do Gemini"
          description="Necessária para a Transcrição."
          status={status}
          onStatus={onStatus}
        />
        <KeyField
          provider="groq"
          title="Chave da Groq (opcional)"
          description="Usada primeiro no Resumo e na Conversa."
          status={status}
          onStatus={onStatus}
        />
      </div>
    </StepBody>
  )
}

/** Configuração inicial em tela cheia: FFmpeg, pasta das Reuniões e chaves de IA. */
export function SetupWizard({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0)
  const ffmpeg = useFfmpegSetup(true)
  const ai = useAiStatus()
  const hasGemini = ai.status?.keys.gemini.configured === true

  return (
    <div className="bg-background h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-8 px-6 py-10">
        <header className="flex items-center gap-3">
          <div
            aria-hidden
            className="bg-primary text-primary-foreground grid size-10 place-items-center rounded-xl"
          >
            <AudioLines className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Bem-vindo ao ClearMeet</h1>
            <p className="text-muted-foreground text-sm">Três passos rápidos para começar.</p>
          </div>
        </header>

        <StepIndicator current={step} />

        {step === 0 && <FfmpegStep setup={ffmpeg} />}
        {step === 1 && <FolderStep />}
        {step === 2 &&
          (ai.status ? (
            <AiStep status={ai.status} onStatus={ai.set} />
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> Carregando…
            </p>
          ))}

        <footer className="flex items-center justify-between gap-3">
          <div>
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                <ArrowLeft aria-hidden />
                Voltar
              </Button>
            )}
          </div>
          {step < 2 ? (
            <Button disabled={step === 0 && !ffmpeg.ready} onClick={() => setStep(step + 1)}>
              Continuar
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <Button variant={hasGemini ? 'default' : 'outline'} onClick={onFinish}>
              {hasGemini ? 'Concluir' : 'Configurar depois'}
            </Button>
          )}
        </footer>
      </div>
    </div>
  )
}
