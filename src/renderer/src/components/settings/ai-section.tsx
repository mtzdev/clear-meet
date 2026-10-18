import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { KeyField } from '@/components/settings/key-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAiStatus } from '@/lib/ai'
import { useSettings } from '@/lib/recording'
import {
  GEMINI_TEXT_MODELS,
  GROQ_TEXT_MODELS,
  TRANSCRIPTION_MODELS,
  type TextModelOption
} from '@shared/ai'

function ModelRow() {
  const { settings, update } = useSettings()
  const current = TRANSCRIPTION_MODELS.find((model) => model.id === settings?.transcriptionModel)
  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Modelo da Transcrição</div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            O áudio da Reunião é enviado ao Gemini uma única vez.
          </p>
        </div>
        <Select
          value={settings?.transcriptionModel ?? ''}
          disabled={!settings}
          onValueChange={(transcriptionModel) => update({ transcriptionModel })}
        >
          <SelectTrigger className="w-56" aria-label="Modelo da Transcrição">
            <SelectValue placeholder="Carregando…" />
          </SelectTrigger>
          <SelectContent>
            {TRANSCRIPTION_MODELS.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {current && <p className="text-muted-foreground text-xs">{current.hint}</p>}
    </div>
  )
}

function TextModelRow({
  title,
  description,
  label,
  models,
  value,
  disabled,
  onChange
}: {
  title: string
  description: string
  label: string
  models: readonly TextModelOption[]
  value: string | undefined
  disabled: boolean
  onChange: (id: string) => void
}) {
  const current = models.find((model) => model.id === value)
  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
        <Select value={value ?? ''} disabled={disabled} onValueChange={onChange}>
          <SelectTrigger className="w-56" aria-label={label}>
            <SelectValue placeholder="Carregando…" />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {current && <p className="text-muted-foreground text-xs">{current.hint}</p>}
    </div>
  )
}

function TextModelRows({ hasGroqKey }: { hasGroqKey: boolean }) {
  const { settings, update } = useSettings()
  return (
    <>
      <TextModelRow
        title="Modelo do Resumo e da Conversa na Groq"
        description={
          hasGroqKey
            ? 'Usado primeiro no Resumo e na Conversa.'
            : 'Só vale depois de configurar a chave da Groq.'
        }
        label="Modelo de texto da Groq"
        models={GROQ_TEXT_MODELS}
        value={settings?.groqTextModel}
        disabled={!settings}
        onChange={(groqTextModel) => update({ groqTextModel })}
      />
      <TextModelRow
        title="Modelo do Resumo e da Conversa no Gemini"
        description="Usado sem a chave da Groq ou quando ela não atende."
        label="Modelo de texto do Gemini"
        models={GEMINI_TEXT_MODELS}
        value={settings?.geminiTextModel}
        disabled={!settings}
        onChange={(geminiTextModel) => update({ geminiTextModel })}
      />
    </>
  )
}

/** Seção "IA" das Configurações: chaves (cifradas no Windows) e modelos da Transcrição, do Resumo e da Conversa. */
export function AiSection() {
  const { status, set } = useAiStatus()
  if (!status) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-5 py-4 text-sm">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Carregando…
      </div>
    )
  }
  return (
    <>
      {!status.encryptionAvailable && (
        <div className="text-warning flex items-start gap-2 px-5 py-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            O armazenamento seguro do Windows não está disponível, então as chaves não podem ser
            salvas.
          </p>
        </div>
      )}
      <KeyField
        provider="gemini"
        title="Chave do Gemini"
        description="Necessária para a Transcrição. Fica cifrada neste computador."
        status={status}
        onStatus={set}
      />
      <KeyField
        provider="groq"
        title="Chave da Groq (opcional)"
        description="Usada primeiro no Resumo e na Conversa. Sem ela, o Gemini responde."
        status={status}
        onStatus={set}
      />
      <ModelRow />
      <TextModelRows hasGroqKey={status.keys.groq.configured} />
    </>
  )
}
