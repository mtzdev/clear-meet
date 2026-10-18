import type { QualityPreset } from '@shared/capture'

export const QUALITY_OPTIONS: { value: QualityPreset; label: string; hint: string }[] = [
  { value: '720p', label: '720p', hint: '1280 × 720 · arquivo menor' },
  { value: '1080p', label: '1080p', hint: '1920 × 1080 · recomendado' },
  { value: 'native', label: 'Nativa', hint: 'Resolução da tela ou janela (até 4K)' }
]
