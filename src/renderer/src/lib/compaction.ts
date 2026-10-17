import { useSyncExternalStore } from 'react'

const percents = new Map<string, number>()
const listeners = new Set<() => void>()
let unsubscribe: (() => void) | null = null

function connect(): void {
  if (unsubscribe) return
  unsubscribe = window.api.on('compaction:changed', (event) => {
    if (event.status === 'running' && event.percent !== null)
      percents.set(event.meetingId, event.percent)
    else percents.delete(event.meetingId)
    for (const listener of listeners) listener()
  })
}

function subscribe(listener: () => void): () => void {
  connect()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      unsubscribe?.()
      unsubscribe = null
      percents.clear()
    }
  }
}

/** Andamento (0 a 100) da Compactação da Reunião, ou `null` se não há (ainda) o que mostrar. */
export function useCompactionPercent(meetingId: string): number | null {
  return useSyncExternalStore(subscribe, () => percents.get(meetingId) ?? null)
}
