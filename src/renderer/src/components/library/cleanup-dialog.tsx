import { LoaderCircle } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  CLEANUP_MAX_DAYS,
  CLEANUP_MIN_DAYS,
  CLEANUP_PRESET_DAYS,
  parseCleanupRequest,
  type CleanupMode,
  type CleanupPreview,
  type CleanupRequest,
  type CleanupResult
} from '@shared/cleanup'

type Age = (typeof CLEANUP_PRESET_DAYS)[number] | 'custom'
type Step = 'options' | 'confirm' | 'done'
type PreviewState =
  | { status: 'invalid' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; preview: CleanupPreview }

/** Resposta da prévia e para qual filtro ela vale (respostas de filtros antigos são ignoradas). */
interface Fetched {
  key: string
  state: Exclude<PreviewState, { status: 'invalid' | 'loading' }>
}

const PREVIEW_DEBOUNCE_MS = 300

const MODES: { mode: CleanupMode; title: string; hint: string }[] = [
  {
    mode: 'video',
    title: 'Só o vídeo',
    hint: 'O áudio, a Transcrição, o Resumo e as Anotações ficam. A Reunião continua disponível só com o áudio.'
  },
  {
    mode: 'meeting',
    title: 'Reunião inteira',
    hint: 'Vídeo, áudio, Transcrição, Resumo, Conversa e Anotações.'
  }
]

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function describePreview(preview: CleanupPreview): string {
  return `${plural(preview.count, 'Reunião', 'Reuniões')} · ${formatBytes(preview.bytes)} ${
    preview.count === 1 ? 'será liberado' : 'serão liberados'
  }`
}

function describeEmpty(preview: CleanupPreview, request: CleanupRequest | null): string {
  if (preview.oldestDays == null || !request) return 'Nenhuma Reunião para limpar neste período.'
  const oldest =
    preview.oldestDays === 0 ? 'é de hoje' : `tem ${plural(preview.oldestDays, 'dia', 'dias')}`
  return `Nenhuma reunião gravada há mais de ${plural(request.olderThanDays, 'dia', 'dias')}. A mais antiga ${oldest}.`
}

function skippedText(skipped: number): string {
  return skipped === 1
    ? '1 Reunião em uso fica de fora.'
    : `${skipped} Reuniões em uso ficam de fora.`
}

/** "Liberar espaço": escolhe a idade e o modo, mostra o que sai e envia para a Lixeira. */
export function CleanupDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        {/* O conteúdo sai da tela ao fechar, então reabrir começa do zero. */}
        <CleanupBody onBusy={setBusy} />
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CleanupBody({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [age, setAge] = useState<Age>(30)
  const [customDays, setCustomDays] = useState('120')
  const [mode, setMode] = useState<CleanupMode>('video')
  const [step, setStep] = useState<Step>('options')
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CleanupResult | null>(null)

  const days = age === 'custom' ? Number(customDays) : age
  const request: CleanupRequest | null = parseCleanupRequest({ olderThanDays: days, mode })
  const requestKey = request ? `${request.olderThanDays}:${request.mode}` : null

  const preview: PreviewState = !request
    ? { status: 'invalid' }
    : fetched?.key === requestKey
      ? fetched.state
      : { status: 'loading' }

  useEffect(() => {
    if (step !== 'options' || !request || requestKey === null) return
    let cancelled = false
    const timer = setTimeout(() => {
      window.api.invoke('cleanup:preview', request).then(
        (response) => {
          if (cancelled) return
          setFetched({
            key: requestKey,
            state: response.ok
              ? { status: 'ready', preview: response.value }
              : { status: 'error', message: response.error.message }
          })
        },
        (failure: unknown) => {
          if (cancelled) return
          setFetched({
            key: requestKey,
            state: {
              status: 'error',
              message: failure instanceof Error ? failure.message : String(failure)
            }
          })
        }
      )
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `request` muda de identidade a cada renderização; a chave resume o conteúdo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, requestKey])

  const run = async (): Promise<void> => {
    if (!request) return
    setRunning(true)
    onBusy(true)
    setError(null)
    try {
      const response = await window.api.invoke('cleanup:run', request)
      if (!response.ok) {
        setError(response.error.message)
        return
      }
      setResult(response.value)
      setStep('done')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setRunning(false)
      onBusy(false)
    }
  }

  const ready = preview.status === 'ready' ? preview.preview : null
  const canContinue = ready !== null && ready.count > 0

  return (
    <>
      {step === 'options' && (
        <>
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar espaço</AlertDialogTitle>
            <AlertDialogDescription>
              Deleta as Reuniões mais antigas que o período escolhido.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Gravadas há mais de</legend>
              <div className="flex flex-wrap items-center gap-2">
                {CLEANUP_PRESET_DAYS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant={age === preset ? 'secondary' : 'outline'}
                    aria-pressed={age === preset}
                    onClick={() => setAge(preset)}
                  >
                    {preset} dias
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant={age === 'custom' ? 'secondary' : 'outline'}
                  aria-pressed={age === 'custom'}
                  onClick={() => setAge('custom')}
                >
                  Personalizado
                </Button>
                {age === 'custom' && (
                  <span className="flex items-center gap-2 text-sm">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={CLEANUP_MIN_DAYS}
                      max={CLEANUP_MAX_DAYS}
                      value={customDays}
                      aria-label="Número de dias"
                      aria-invalid={request === null}
                      className="h-8 w-24"
                      onChange={(event) => setCustomDays(event.target.value)}
                    />
                    dias
                  </span>
                )}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">O que apagar</legend>
              <div role="radiogroup" className="grid gap-2">
                {MODES.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    role="radio"
                    aria-checked={mode === option.mode}
                    onClick={() => setMode(option.mode)}
                    className={cn(
                      'focus-visible:ring-ring/60 rounded-lg border p-3 text-left outline-none focus-visible:ring-2',
                      mode === option.mode ? 'border-primary bg-accent/50' : 'hover:bg-accent/30'
                    )}
                  >
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {option.hint}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div role="status" aria-live="polite" className="min-h-10 text-sm">
              {preview.status === 'invalid' && (
                <p className="text-muted-foreground">
                  Informe um número de dias entre {CLEANUP_MIN_DAYS} e {CLEANUP_MAX_DAYS}.
                </p>
              )}
              {preview.status === 'loading' && (
                <p className="text-muted-foreground flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  Calculando…
                </p>
              )}
              {preview.status === 'error' && <p className="text-destructive">{preview.message}</p>}
              {ready && (
                <>
                  <p className="font-medium">
                    {ready.count === 0 ? describeEmpty(ready, request) : describePreview(ready)}
                  </p>
                  {ready.skipped > 0 && (
                    <p className="text-muted-foreground text-xs">{skippedText(ready.skipped)}</p>
                  )}
                </>
              )}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button disabled={!canContinue} onClick={() => setStep('confirm')}>
              Continuar
            </Button>
          </AlertDialogFooter>
        </>
      )}

      {step === 'confirm' && ready && (
        <>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === 'video'
                ? `Enviar o vídeo de ${plural(ready.count, 'Reunião', 'Reuniões')} para a Lixeira?`
                : `Enviar ${plural(ready.count, 'Reunião', 'Reuniões')} para a Lixeira?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {describePreview(ready)}. O espaço só volta de fato quando a Lixeira for
                  esvaziada.
                </p>
                {ready.skipped > 0 && <p>{skippedText(ready.skipped)}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <Button variant="outline" disabled={running} onClick={() => setStep('options')}>
              Voltar
            </Button>
            <Button variant="destructive" disabled={running} onClick={() => void run()}>
              {running && <LoaderCircle className="animate-spin" aria-hidden />}
              Enviar para a Lixeira
            </Button>
          </AlertDialogFooter>
        </>
      )}

      {step === 'done' && result && (
        <>
          <AlertDialogHeader>
            <AlertDialogTitle>{formatBytes(result.freedBytes)} liberados</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1">
                <p>
                  {result.removed === 0
                    ? 'Nada foi enviado para a Lixeira.'
                    : `${plural(result.removed, 'Reunião enviada', 'Reuniões enviadas')} para a Lixeira.`}
                </p>
                {result.skipped > 0 && (
                  <p>
                    {plural(result.skipped, 'Reunião ficou', 'Reuniões ficaram')} de fora por estar
                    em uso.
                  </p>
                )}
                {result.failed > 0 && (
                  <p>
                    {plural(result.failed, 'Reunião não pôde', 'Reuniões não puderam')} ser enviada:
                    algum programa está usando os arquivos.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
          </AlertDialogFooter>
        </>
      )}
    </>
  )
}
