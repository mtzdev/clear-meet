import { useCallback, useEffect, useState } from 'react'
import type { IpcInvokeArgs, IpcResponse, VoidChannel } from '@shared/ipc'

export type IpcQuery<C extends VoidChannel> =
  | { status: 'loading'; reload: () => void }
  | { status: 'ready'; data: IpcResponse<C>; reload: () => void }
  | { status: 'error'; error: string; reload: () => void }

type QueryState<C extends VoidChannel> =
  | { status: 'loading' }
  | { status: 'ready'; data: IpcResponse<C> }
  | { status: 'error'; error: string }

/** Consulta um canal IPC sem parâmetros e acompanha carregando/pronto/erro. */
export function useIpcQuery<C extends VoidChannel>(channel: C): IpcQuery<C> {
  const [state, setState] = useState<QueryState<C>>({ status: 'loading' })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.api.invoke(channel, ...([] as unknown as IpcInvokeArgs<C>)).then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data })
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
  }, [channel, version])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setVersion((current) => current + 1)
  }, [])

  return { ...state, reload }
}
