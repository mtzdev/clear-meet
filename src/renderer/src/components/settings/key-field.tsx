import { CircleCheck, ExternalLink, Eye, EyeOff, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { openExternal } from '@/lib/ai'
import {
  AI_PROVIDER_LABEL,
  API_KEY_LINKS,
  type AiProvider,
  type AiStatus,
  type KeyTestResult
} from '@shared/ai'

type Feedback = { tone: 'ok' | 'error'; text: string } | null

export interface KeyFieldProps {
  provider: AiProvider
  title: string
  description: string
  status: AiStatus
  onStatus: (status: AiStatus) => void
}

/** Campo de uma chave de IA: colar, testar, salvar e remover (a chave só existe cifrada no main). */
export function KeyField({ provider, title, description, status, onStatus }: KeyFieldProps) {
  const [value, setValue] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const keyStatus = status.keys[provider]
  const typed = value.trim()
  const inputId = `api-key-${provider}`

  const describeTest = (result: KeyTestResult, success: string): Feedback =>
    result.ok ? { tone: 'ok', text: success } : { tone: 'error', text: result.message }

  const test = async (): Promise<void> => {
    setBusy('test')
    setFeedback(null)
    try {
      const result = await window.api.invoke('ai:testKey', {
        provider,
        key: typed === '' ? null : typed
      })
      setFeedback(describeTest(result, 'A chave funciona.'))
    } catch {
      setFeedback({ tone: 'error', text: 'Não foi possível testar a chave.' })
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    setFeedback(null)
    try {
      const saved = await window.api.invoke('ai:setKey', { provider, key: typed })
      if (!saved.ok) {
        setFeedback({ tone: 'error', text: saved.error.message })
        return
      }
      onStatus(saved.value)
      setValue('')
      setVisible(false)
      const result = await window.api.invoke('ai:testKey', { provider, key: null })
      setFeedback(
        result.ok
          ? { tone: 'ok', text: 'Chave salva e funcionando.' }
          : { tone: 'error', text: `Chave salva, mas o teste falhou. ${result.message}` }
      )
    } catch {
      setFeedback({ tone: 'error', text: 'Não foi possível salvar a chave.' })
    } finally {
      setBusy(null)
    }
  }

  const clear = async (): Promise<void> => {
    setBusy('clear')
    setFeedback(null)
    try {
      onStatus(await window.api.invoke('ai:clearKey', { provider }))
      setValue('')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={inputId} className="text-sm font-medium">
            {title}
          </label>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
        {keyStatus.configured ? (
          <span className="text-success inline-flex shrink-0 items-center gap-1.5 text-xs font-medium">
            <CircleCheck className="size-4" aria-hidden />
            Configurada · final {keyStatus.last4}
          </span>
        ) : (
          <span className="text-muted-foreground shrink-0 text-xs">Não configurada</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            id={inputId}
            type={visible ? 'text' : 'password'}
            value={value}
            autoComplete="off"
            spellCheck={false}
            disabled={busy !== null || !status.encryptionAvailable}
            placeholder={keyStatus.configured ? 'Cole uma nova chave para trocar' : 'Cole a chave'}
            className="pr-10 font-mono text-xs"
            onChange={(event) => {
              setValue(event.target.value)
              setFeedback(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && typed !== '' && busy === null) void save()
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-1.5 -translate-y-1/2"
            aria-label={visible ? 'Ocultar a chave' : 'Mostrar a chave'}
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
        <Button
          variant="outline"
          disabled={busy !== null || (typed === '' && !keyStatus.configured)}
          onClick={() => void test()}
        >
          {busy === 'test' && <LoaderCircle className="animate-spin" aria-hidden />}
          Testar
        </Button>
        <Button
          disabled={busy !== null || typed === '' || !status.encryptionAvailable}
          onClick={() => void save()}
        >
          {busy === 'save' && <LoaderCircle className="animate-spin" aria-hidden />}
          Salvar
        </Button>
      </div>

      <div className="flex items-center justify-between gap-4 text-xs">
        <button
          type="button"
          className="text-primary focus-visible:ring-ring/60 inline-flex items-center gap-1 rounded outline-none hover:underline focus-visible:ring-2"
          onClick={() => openExternal(API_KEY_LINKS[provider])}
        >
          Obter a chave da {AI_PROVIDER_LABEL[provider]}
          <ExternalLink className="size-3" aria-hidden />
        </button>
        {keyStatus.configured && (
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive rounded outline-none hover:underline disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void clear()}
          >
            Remover a chave
          </button>
        )}
      </div>

      {feedback && (
        <p
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          className={
            feedback.tone === 'ok'
              ? 'text-success flex items-start gap-1.5 text-xs'
              : 'text-destructive flex items-start gap-1.5 text-xs'
          }
        >
          {feedback.tone === 'ok' ? (
            <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          ) : (
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          {feedback.text}
        </p>
      )}
    </div>
  )
}
