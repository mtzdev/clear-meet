import { useCallback, useEffect, useState } from 'react'
import type { SummaryFile, SummaryView } from '@shared/summary'

/** Estado do Resumo de uma Reunião: o que veio ao abrir a tela, atualizado pelos eventos do main. */
export function useSummaryView(meetingId: string, initial: SummaryView): SummaryView {
  const [view, setView] = useState(initial)
  useEffect(
    () =>
      window.api.on('summary:changed', (event) => {
        if (event.meetingId === meetingId) setView(event.view)
      }),
    [meetingId]
  )
  return view
}

export type SummaryDataState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; summary: SummaryFile }

/** Carrega o `summary.json` quando o Resumo está pronto (e de novo se ele for refeito). */
export function useSummaryData(folder: string, view: SummaryView): SummaryDataState {
  const [state, setState] = useState<SummaryDataState>({ status: 'none' })
  const ready = view.status === 'ready'
  const version = view.updatedAt

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void window.api.invoke('summary:get', { folder }).then(
      (result) => {
        if (cancelled) return
        if (!result.ok) setState({ status: 'error', error: result.error.message })
        else if (result.value) setState({ status: 'ready', summary: result.value })
        else setState({ status: 'error', error: 'O arquivo do Resumo não foi encontrado.' })
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [folder, ready, version])

  return ready ? state : { status: 'none' }
}

export interface SummaryActions {
  /** Devolve a mensagem de erro, se não deu para começar. */
  start: () => Promise<string | null>
  cancel: () => void
}

export function useSummaryActions(folder: string): SummaryActions {
  const start = useCallback(async (): Promise<string | null> => {
    try {
      const result = await window.api.invoke('summary:start', { folder })
      return result.ok ? null : result.error.message
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, [folder])
  const cancel = useCallback(() => {
    void window.api.invoke('summary:cancel', { folder })
  }, [folder])
  return { start, cancel }
}
