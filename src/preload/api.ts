import { isIpcChannel, isIpcEvent, type RendererApi } from '@shared/ipc'

/** Parte de `ipcRenderer` que usamos (permite testar sem Electron). */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

/**
 * Monta a API exposta ao renderer. Só encaminha canais e eventos do contrato:
 * o renderer não consegue invocar nem escutar canais arbitrários.
 */
export function createRendererApi(ipc: IpcRendererLike): RendererApi {
  return {
    invoke: ((channel: string, ...args: unknown[]) => {
      if (!isIpcChannel(channel)) {
        return Promise.reject(new Error(`Canal IPC desconhecido: ${String(channel)}`))
      }
      return ipc.invoke(channel, ...args)
    }) as RendererApi['invoke'],
    on: ((event: string, listener: (payload: unknown) => void) => {
      if (!isIpcEvent(event)) throw new Error(`Evento IPC desconhecido: ${String(event)}`)
      // O objeto `event` do Electron não é repassado ao renderer: só o conteúdo.
      const wrapped = (_event: unknown, payload: unknown): void => listener(payload)
      ipc.on(event, wrapped)
      return () => ipc.removeListener(event, wrapped)
    }) as RendererApi['on']
  }
}
