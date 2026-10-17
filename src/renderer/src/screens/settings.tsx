import { CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Screen } from '@/components/layout/screen'
import { AiSection } from '@/components/settings/ai-section'
import { CompactionSection } from '@/components/settings/compaction-section'
import { useIpcQuery } from '@/lib/ipc'
import type { FfmpegSource, FfmpegStatus } from '@shared/ffmpeg'

const SOURCE_LABEL: Record<FfmpegSource, string> = {
  env: 'Variável FFMPEG_PATH',
  downloaded: 'Baixado pelo app',
  vendor: 'Pasta vendor (desenvolvimento)'
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h2>
      <div className="bg-card divide-border border-border divide-y rounded-xl border">
        {children}
      </div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div>}
      </div>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  )
}

function Path({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">-</span>
  return (
    <span
      title={value}
      className="text-muted-foreground block max-w-[22rem] truncate font-mono text-xs"
    >
      {value}
    </span>
  )
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

function FfmpegRows() {
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
    </>
  )
}

function VersionRow() {
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

export function SettingsScreen() {
  return (
    <Screen title="Configurações">
      <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
        <Section title="Aparência">
          <Row label="Tema" hint="Acompanha o modo claro ou escuro do Windows.">
            <span className="text-muted-foreground">Automático</span>
          </Row>
        </Section>
        <Section title="IA">
          <AiSection />
        </Section>
        <Section title="Compactação">
          <CompactionSection />
        </Section>
        <Section title="Sistema">
          <VersionRow />
          <FfmpegRows />
        </Section>
      </div>
    </Screen>
  )
}
