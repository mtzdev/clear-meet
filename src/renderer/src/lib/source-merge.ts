import type { CaptureSourceInfo } from '@shared/recording'

function sameSource(a: CaptureSourceInfo, b: CaptureSourceInfo): boolean {
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.minimized === b.minimized &&
    a.thumbKey === b.thumbKey &&
    a.thumbnail === b.thumbnail &&
    a.appIcon === b.appIcon
  )
}

/**
 * Junta a lista nova com a atual mantendo o que não mudou: objetos iguais voltam como a mesma
 * referência (o React não refaz esses cartões), miniaturas e ícones que o main não reenviou
 * são reaproveitados e a ordem não muda (as janelas novas entram no fim). Se nada mudou
 * devolve a própria lista atual.
 */
export function mergeSources(
  current: CaptureSourceInfo[],
  incoming: CaptureSourceInfo[]
): CaptureSourceInfo[] {
  const before = new Map(current.map((source) => [source.id, source]))
  const merged = new Map<string, CaptureSourceInfo>()
  for (const source of incoming) {
    const old = before.get(source.id)
    const next: CaptureSourceInfo = old
      ? {
          ...source,
          thumbnail: source.thumbnail ?? (old.thumbKey === source.thumbKey ? old.thumbnail : null),
          appIcon: source.appIcon ?? old.appIcon
        }
      : source
    merged.set(source.id, old && sameSource(old, next) ? old : next)
  }

  const result: CaptureSourceInfo[] = []
  for (const source of current) {
    const kept = merged.get(source.id)
    if (kept) result.push(kept)
  }
  for (const source of incoming) {
    if (!before.has(source.id)) result.push(merged.get(source.id)!)
  }

  const unchanged =
    result.length === current.length && result.every((source, index) => source === current[index])
  return unchanged ? current : result
}

/** O que a UI já tem de cada miniatura, para o main não reenviar (`''` = sem miniatura). */
export function knownThumbnails(sources: CaptureSourceInfo[]): Record<string, string> {
  const known: Record<string, string> = {}
  for (const source of sources) {
    if (source.thumbKey === null) known[source.id] = ''
    else if (source.thumbnail !== null) known[source.id] = source.thumbKey
  }
  return known
}
