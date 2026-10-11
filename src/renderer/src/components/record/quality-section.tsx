import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { isQualityPreset, type QualityPreset } from '@shared/capture'

interface QualitySectionProps {
  value: QualityPreset
  disabled?: boolean
  onChange: (value: QualityPreset) => void
}

const OPTIONS: { value: QualityPreset; label: string; hint: string }[] = [
  { value: '720p', label: '720p', hint: '1280 × 720 · arquivo menor' },
  { value: '1080p', label: '1080p', hint: '1920 × 1080 · recomendado' },
  { value: 'native', label: 'Nativa', hint: 'Resolução da tela ou janela (até 4K)' }
]

/** Preset de qualidade do Vídeo (15 quadros por segundo em todos). */
export function QualitySection({ value, disabled, onChange }: QualitySectionProps) {
  const current = OPTIONS.find((option) => option.value === value)
  return (
    <section className="space-y-3" aria-labelledby="quality-title">
      <h2 id="quality-title" className="text-sm font-semibold tracking-tight">
        Qualidade do vídeo
      </h2>
      <div className="space-y-2.5">
        <ToggleGroup
          type="single"
          className="w-full"
          variant="outline"
          value={value}
          disabled={disabled}
          aria-labelledby="quality-title"
          onValueChange={(next) => {
            // O grupo devolve '' ao clicar no item já marcado: mantém a escolha.
            if (isQualityPreset(next)) onChange(next)
          }}
        >
          {OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-muted-foreground text-xs">{current?.hint}</p>
      </div>
    </section>
  )
}
