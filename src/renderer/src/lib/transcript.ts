import { useCallback, useEffect, useState } from 'react'
import type { TranscriptFile, TranscriptView } from '@shared/transcript'

/** Estado da Transcrição de uma Reunião: o que veio ao abrir a tela, atualizado pelos eventos do main. */
export function useTranscriptView(meetingId: string, initial: TranscriptView): TranscriptView {
  const [view, setView] = useState(initial)
  useEffect(
    () =>
      window.api.on('transcript:changed', (event) => {
        if (event.meetingId === meetingId) setView(event.view)
      }),
    [meetingId]
  )
  return view
}

export type TranscriptDataState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; transcript: TranscriptFile }

/** Carrega o `transcript.json` quando a Transcrição está pronta (e de novo se ela for refeita). */
export function useTranscriptData(
  folder: string,
  view: TranscriptView
): { data: TranscriptDataState; replace: (transcript: TranscriptFile) => void } {
  const [state, setState] = useState<TranscriptDataState>({ status: 'none' })
  const ready = view.status === 'ready'
  const version = view.updatedAt

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void window.api.invoke('transcript:get', { folder }).then(
      (result) => {
        if (cancelled) return
        if (!result.ok) setState({ status: 'error', error: result.error.message })
        else if (result.value) setState({ status: 'ready', transcript: result.value })
        else setState({ status: 'error', error: 'O arquivo da Transcrição não foi encontrado.' })
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

  const replace = useCallback((transcript: TranscriptFile) => {
    setState({ status: 'ready', transcript })
  }, [])

  return { data: ready ? state : { status: 'none' }, replace }
}

export interface TranscriptActions {
  /** `model` troca o modelo só desta Transcrição. */
  start: (requestSummary: boolean, model?: string) => Promise<string | null>
  cancel: () => void
}

/** Ações sobre a Transcrição de uma Reunião. `start` devolve a mensagem de erro, se houver. */
export function useTranscriptActions(folder: string): TranscriptActions {
  const start = useCallback(
    async (requestSummary: boolean, model?: string): Promise<string | null> => {
      try {
        const result = await window.api.invoke('transcript:start', {
          folder,
          requestSummary,
          ...(model ? { model } : {})
        })
        return result.ok ? null : result.error.message
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    [folder]
  )
  const cancel = useCallback(() => {
    void window.api.invoke('transcript:cancel', { folder })
  }, [folder])
  return { start, cancel }
}
