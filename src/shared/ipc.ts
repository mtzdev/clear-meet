import type { FfmpegStatus } from './ffmpeg'
import type {
  AudioLevels,
  CaptureSourceInfo,
  FinishedRecording,
  PreflightInfo,
  RecordingState,
  RecoveryReport,
  RenamedMeeting,
  Result,
  StartRecordingRequest
} from './recording'
import type { SettingsPatch, SettingsView } from './settings'

/**
 * Contrato único de IPC (renderer -> main). Cada canal declara o tipo do
 * pedido e da resposta; main, preload e renderer derivam tudo daqui.
 * Para adicionar um canal: declare-o em `IpcContract`, em `IPC_CHANNELS`
 * (o compilador cobra) e implemente o handler em `src/main/ipc/handlers.ts`.
 */
export interface IpcContract {
  'app:getVersion': { request: void; response: string }
  'ffmpeg:status': { request: void; response: FfmpegStatus }
  /** Telas e janelas disponíveis, com miniaturas. */
  'capture:listSources': { request: void; response: CaptureSourceInfo[] }
  /** Pasta das Reuniões, espaço livre e FFmpeg, para avisar antes de gravar. */
  'recording:preflight': { request: void; response: PreflightInfo }
  'recording:getState': { request: void; response: RecordingState }
  'recording:start': { request: StartRecordingRequest; response: Result<null> }
  'recording:pause': { request: void; response: Result<null> }
  'recording:resume': { request: void; response: Result<null> }
  /** Encerra a gravação e devolve a Reunião já finalizada (também fica em `RecordingState.finished`). */
  'recording:stop': { request: void; response: Result<FinishedRecording> }
  /** A UI já mostrou o resultado da última gravação: limpa `finished` do estado. */
  'recording:acknowledge': { request: void; response: null }
  /** Renomeia a Reunião no `meeting.json` e, se possível, a pasta. */
  'meeting:rename': { request: { folder: string; name: string }; response: Result<RenamedMeeting> }
  'meeting:reveal': { request: { folder: string }; response: null }
  'settings:get': { request: void; response: SettingsView }
  'settings:update': { request: SettingsPatch; response: SettingsView }
  'recovery:getReport': { request: void; response: RecoveryReport }
  'recovery:retry': { request: void; response: RecoveryReport }
}

/** Eventos main -> renderer (a UI se inscreve com `window.api.on`). */
export interface IpcEventContract {
  'recording:state': RecordingState
  'recording:level': AudioLevels
  'recovery:report': RecoveryReport
}

export type IpcEventName = keyof IpcEventContract
export type IpcEventPayload<E extends IpcEventName> = IpcEventContract[E]

export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/** Argumentos de `invoke`: canais com pedido `void` não recebem argumento. */
export type IpcInvokeArgs<C extends IpcChannel> = [IpcRequest<C>] extends [void]
  ? []
  : [request: IpcRequest<C>]

/** Canais cujo pedido é `void` (consultas sem parâmetros). */
export type VoidChannel = {
  [C in IpcChannel]: [IpcRequest<C>] extends [void] ? C : never
}[IpcChannel]

/** Implementação de um canal no main. */
export type IpcHandler<C extends IpcChannel> = (
  request: IpcRequest<C>
) => IpcResponse<C> | Promise<IpcResponse<C>>

/** Um handler por canal do contrato (o compilador exige todos). */
export type IpcHandlers = { [C in IpcChannel]: IpcHandler<C> }

/** Lista de canais em runtime (o preload só encaminha canais conhecidos). */
export const IPC_CHANNELS = {
  'app:getVersion': true,
  'ffmpeg:status': true,
  'capture:listSources': true,
  'recording:preflight': true,
  'recording:getState': true,
  'recording:start': true,
  'recording:pause': true,
  'recording:resume': true,
  'recording:stop': true,
  'recording:acknowledge': true,
  'meeting:rename': true,
  'meeting:reveal': true,
  'settings:get': true,
  'settings:update': true,
  'recovery:getReport': true,
  'recovery:retry': true
} as const satisfies Record<IpcChannel, true>

export const IPC_EVENTS = {
  'recording:state': true,
  'recording:level': true,
  'recovery:report': true
} as const satisfies Record<IpcEventName, true>

export function isIpcEvent(value: unknown): value is IpcEventName {
  return typeof value === 'string' && Object.hasOwn(IPC_EVENTS, value)
}

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && Object.hasOwn(IPC_CHANNELS, value)
}

/** API exposta ao renderer em `window.api`. */
export interface RendererApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcInvokeArgs<C>): Promise<IpcResponse<C>>
  /** Inscreve-se num evento do main; devolve a função que cancela a inscrição. */
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEventPayload<E>) => void): () => void
}
