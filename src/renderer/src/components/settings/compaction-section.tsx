import { Info } from 'lucide-react'
import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSettings } from '@/lib/recording'
import { isCompactionMode, type CompactionMode } from '@shared/compaction'

const MODES: { id: CompactionMode; label: string; hint: string }[] = [
  {
    id: 'speed',
    label: 'Velocidade',
    hint: 'Mais rápido, com bom equilíbrio de tamanho e qualidade.'
  },
  {
    id: 'quality',
    label: 'Qualidade máxima',
    hint: 'Mais lento, preserva mais detalhes e gera arquivos maiores.'
  }
]

/** Compactação do Vídeo depois da gravação: liga/desliga e escolhe velocidade ou qualidade. */
export function CompactionSection() {
  const { settings, update } = useSettings()
  const current = MODES.find((mode) => mode.id === settings?.compactionMode)
  const [infoOpen, setInfoOpen] = useState(false)
  return (
    <>
      <div className="flex items-start justify-between gap-6 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div id="compaction-label" className="text-sm font-medium">
              Compactar o vídeo depois da gravação
            </div>
            <Tooltip open={infoOpen} onOpenChange={setInfoOpen}>
              {/* O Radix fecha o tooltip ao clicar no gatilho; aqui o clique abre e ele só fecha ao tirar o mouse. */}
              <TooltipTrigger
                asChild
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault()
                  setInfoOpen(true)
                }}
              >
                <button
                  type="button"
                  aria-label="Sobre a Compactação"
                  className="text-muted-foreground hover:text-foreground cursor-pointer rounded-full"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Usa o processador (ou a placa de vídeo, quando compatível). Em computadores mais
                lentos, pode demorar e deixar o sistema mais pesado enquanto roda.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Reduz automaticamente o tamanho dos vídeos após a gravação, sem comprometer a qualidade.
            Ao desativar essa opção, as reuniões já compactadas não são afetadas.
          </p>
        </div>
        <Switch
          aria-labelledby="compaction-label"
          checked={settings?.compaction ?? true}
          disabled={!settings}
          onCheckedChange={(compaction) => update({ compaction })}
        />
      </div>
      <div className="flex items-center justify-between gap-6 px-5 py-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Prioridade</div>
          {current && <p className="text-muted-foreground mt-0.5 text-xs">{current.hint}</p>}
        </div>
        <Select
          value={settings?.compactionMode ?? ''}
          disabled={!settings || !settings.compaction}
          onValueChange={(value) => {
            if (isCompactionMode(value)) update({ compactionMode: value })
          }}
        >
          <SelectTrigger className="w-56" aria-label="Prioridade da Compactação">
            <SelectValue placeholder="Carregando…" />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((mode) => (
              <SelectItem key={mode.id} value={mode.id}>
                {mode.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  )
}
