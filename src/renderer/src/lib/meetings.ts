import { useCallback, useEffect, useRef, useState } from 'react'
import type { MeetingDetail } from '@shared/library'
import type { MeetingNote } from '@shared/meeting'

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; detail: MeetingDetail }

export interface MeetingDetailQuery {
  state: DetailState
  /** Relê a Reunião do disco (sem voltar ao estado "carregando"). */
  reload: () => Promise<void>
  updateNotes: (update: (notes: MeetingNote[]) => MeetingNote[]) => void
}

async function fetchDetail(id: string): Promise<DetailState> {
  try {
    const result = await window.api.invoke('meeting:get', { id })
    return result.ok
      ? { status: 'ready', detail: result.value }
      : { status: 'error', error: result.error.message }
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Carrega a Reunião pelo `id`. Recarrega quando `refreshKey` muda (ex.: a gravação terminou
 * e a Reunião deixou de estar bloqueada). Respostas antigas são descartadas.
 */
export function useMeetingDetail(id: string, refreshKey: unknown): MeetingDetailQuery {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const requests = useRef(0)

  useEffect(() => {
    let cancelled = false
    void fetchDetail(id).then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [id, refreshKey])

  const reload = useCallback(async (): Promise<void> => {
    const request = ++requests.current
    const next = await fetchDetail(id)
    if (request === requests.current) setState(next)
  }, [id])

  const updateNotes = useCallback((update: (notes: MeetingNote[]) => MeetingNote[]) => {
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', detail: { ...current.detail, notes: update(current.detail.notes) } }
        : current
    )
  }, [])

  return { state, reload, updateNotes }
}
