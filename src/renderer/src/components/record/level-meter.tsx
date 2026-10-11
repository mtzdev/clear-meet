import { levelToFraction } from '@/lib/audio-level'
import { cn } from '@/lib/utils'

interface LevelMeterProps {
  /** Pico de 0 a 1 (amostra bruta; a escala em dB é aplicada aqui). */
  level: number
  /** Texto lido por leitores de tela (o medidor em si é decorativo). */
  label: string
  className?: string
}

/** Barra de nível de áudio: verde, amarela perto do topo e vermelha no limite. */
export function LevelMeter({ level, label, className }: LevelMeterProps) {
  const fraction = levelToFraction(level)
  const tone = fraction > 0.93 ? 'bg-destructive' : fraction > 0.78 ? 'bg-warning' : 'bg-success'
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      className={cn('bg-muted h-1.5 w-full overflow-hidden rounded-full', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-75', tone)}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  )
}
