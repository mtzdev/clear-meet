import type { CaptureSourceInfo, CaptureSourceRef } from '@shared/recording'

export const AUDIO_ONLY: CaptureSourceRef = { kind: 'none' }

export function toRef(source: CaptureSourceInfo): CaptureSourceRef {
  return { kind: source.kind, id: source.id, name: source.name }
}

export function isSameSource(a: CaptureSourceRef | null, b: CaptureSourceRef | null): boolean {
  if (!a || !b) return a === b
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind
  return a.kind === b.kind && a.id === b.id
}

/**
 * Fonte efetiva: a escolhida, se ainda existe; senão a tela principal (primeira da lista);
 * senão "só áudio". Assim a seleção nunca aponta para uma janela que já fechou.
 */
export function resolveSelection(
  chosen: CaptureSourceRef | null,
  sources: CaptureSourceInfo[]
): CaptureSourceRef {
  if (chosen?.kind === 'none') return chosen
  if (chosen) {
    const match = sources.find((source) => source.id === chosen.id)
    if (match) return toRef(match)
  }
  const firstScreen = sources.find((source) => source.kind === 'screen')
  return firstScreen ? toRef(firstScreen) : AUDIO_ONLY
}
