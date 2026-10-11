import { IPC_CHANNELS, type IpcChannel, type IpcHandlers } from '@shared/ipc'

/** Parte de `ipcMain` que usamos (permite testar sem Electron). */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

/**
 * Registra um handler para cada canal do contrato. `IpcHandlers` exige todos os
 * canais em tempo de compilação; aqui só ligamos cada um ao `ipcMain`.
 */
export function registerIpcHandlers(ipc: IpcMainLike, handlers: IpcHandlers): void {
  for (const channel of Object.keys(IPC_CHANNELS) as IpcChannel[]) {
    // Os pedidos do contrato têm no máximo um argumento.
    const handler = handlers[channel] as (request?: unknown) => unknown
    ipc.handle(channel, (_event, request) => handler(request))
  }
}
