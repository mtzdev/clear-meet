import { formatInstant } from '@shared/timeline'

/** Instante citado: ao clicar, o player vai até ele. */
export function InstantLink({ ms, onSeek }: { ms: number; onSeek: (ms: number) => void }) {
  const label = formatInstant(ms)
  return (
    <button
      type="button"
      aria-label={`Ir para ${label}`}
      className="text-primary focus-visible:ring-ring/60 mx-0.5 cursor-pointer rounded text-xs font-medium tabular-nums outline-none hover:underline focus-visible:ring-2"
      onClick={() => onSeek(ms)}
    >
      {label}
    </button>
  )
}
