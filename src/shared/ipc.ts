import type { AiProvider, AiStatus, KeyTestResult } from './ai'
import type { ChatEvent, ChatSent, ChatState } from './chat'
import type { FfmpegStatus } from './ffmpeg'
import type { FloatingInfo, NoteSavedEvent } from './floating'
import type { LibraryQuery, LibraryResult, MeetingDetail } from './library'
import type { MeetingNote } from './meeting'
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
import type { SummaryChangedEvent, SummaryFile } from './summary'
import type { TranscriptChangedEvent, TranscriptFile } from './transcript'

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
  /** Lista e busca de Reuniões no índice (nome, conteúdo, datas, ordenação). */
  'library:search': { request: LibraryQuery; response: LibraryResult }
  /** Reconcilia o índice com as pastas (abrir a tela Reuniões); ignorado se acabou de rodar. */
  'library:refresh': { request: void; response: null }
  /** Abre uma Reunião pelo `id` (o `meeting.json` é a verdade; a pasta pode ter sido renomeada). */
  'meeting:get': { request: { id: string }; response: Result<MeetingDetail> }
  /** Anotações depois da gravação (só Reuniões prontas). `offsetMs` é o Instante. */
  'meeting:addNote': {
    request: { folder: string; offsetMs: number; text: string }
    response: Result<MeetingNote>
  }
  'meeting:updateNote': {
    request: { folder: string; noteId: string; text: string }
    response: Result<MeetingNote>
  }
  'meeting:deleteNote': { request: { folder: string; noteId: string }; response: Result<null> }
  /** Transcrição pronta (`transcript.json`), ou `null` se a Reunião ainda não tem. */
  'transcript:get': { request: { folder: string }; response: Result<TranscriptFile | null> }
  /** Começa a Transcrição em segundo plano (ou retoma uma que falhou); o andamento vem por evento. */
  'transcript:start': {
    request: { folder: string; requestSummary: boolean; model?: string }
    response: Result<null>
  }
  'transcript:cancel': { request: { folder: string }; response: null }
  /** Renomeia um Falante em `transcript.json` (vale para a Transcrição inteira). */
  'transcript:renameSpeaker': {
    request: { folder: string; speakerId: string; name: string }
    response: Result<TranscriptFile>
  }
  /** Resumo pronto (`summary.json`), ou `null` se a Reunião ainda não tem. */
  'summary:get': { request: { folder: string }; response: Result<SummaryFile | null> }
  /** Gera o Resumo em segundo plano (ou refaz o que existe); o andamento vem por evento. */
  'summary:start': { request: { folder: string }; response: Result<null> }
  'summary:cancel': { request: { folder: string }; response: null }
  /** Conversa da Reunião: mensagens salvas e a resposta em geração, se houver. */
  'chat:get': { request: { folder: string }; response: Result<ChatState> }
  /** Faz uma pergunta; `text: null` repete a última pergunta que ficou sem resposta. */
  'chat:send': { request: { folder: string; text: string | null }; response: Result<ChatSent> }
  /** Para a resposta em geração (o que já chegou fica salvo). */
  'chat:stop': { request: { folder: string }; response: null }
  'chat:clear': { request: { folder: string }; response: Result<null> }
  /** Chaves de IA: o renderer só vê "configurada" e os últimos 4 caracteres. */
  'ai:getStatus': { request: void; response: AiStatus }
  'ai:setKey': { request: { provider: AiProvider; key: string }; response: Result<AiStatus> }
  'ai:clearKey': { request: { provider: AiProvider }; response: AiStatus }
  /** Valida uma chave com uma chamada barata; sem `key`, testa a salva. */
  'ai:testKey': { request: { provider: AiProvider; key: string | null }; response: KeyTestResult }
  /** Abre no navegador um dos endereços permitidos (links para obter as chaves). */
  'app:openExternal': { request: { url: string }; response: null }
  'settings:get': { request: void; response: SettingsView }
  'settings:update': { request: SettingsPatch; response: SettingsView }
  'recovery:getReport': { request: void; response: RecoveryReport }
  'recovery:retry': { request: void; response: RecoveryReport }
  /** Barra flutuante: atalho das Anotações e se ele foi registrado. */
  'floating:getInfo': { request: void; response: FloatingInfo }
  /** A barra pede a altura que o conteúdo precisa (cresce com a linha de avisos). */
  'floating:resize': { request: { height: number }; response: null }
  /** Traz de volta a janela principal (que fica oculta durante a gravação). */
  'floating:showMain': { request: void; response: null }
  /** Abre o campo de Anotação (botão da barra; o atalho global faz o mesmo). */
  'notes:openEditor': { request: void; response: null }
  /** O usuário começou a digitar: fixa o Instante da Anotação (primeira tecla menos o recuo). */
  'notes:begin': { request: void; response: null }
  /** Salva a Anotação no `meeting.json` e fecha o campo; texto vazio não salva. */
  'notes:save': { request: { text: string }; response: Result<null> }
  /** Fecha o campo sem salvar e devolve o foco ao app anterior. */
  'notes:cancel': { request: void; response: null }
}

/** Eventos main -> renderer (a UI se inscreve com `window.api.on`). */
export interface IpcEventContract {
  'recording:state': RecordingState
  'recording:level': AudioLevels
  'recovery:report': RecoveryReport
  'floating:info': FloatingInfo
  /** Uma Anotação foi salva (a barra mostra um aviso breve). */
  'notes:saved': NoteSavedEvent
  /** O campo de Anotação foi aberto: a UI limpa o texto e foca. */
  'notes:opened': null
  /** O estado ou o progresso da Transcrição de uma Reunião mudou. */
  'transcript:changed': TranscriptChangedEvent
  /** O estado do Resumo de uma Reunião mudou. */
  'summary:changed': SummaryChangedEvent
  /** Resposta da Conversa chegando, concluída ou com erro. */
  'chat:event': ChatEvent
  /** O índice da Biblioteca mudou: telas com lista de Reuniões consultam de novo. */
  'library:changed': null
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
  'library:search': true,
  'library:refresh': true,
  'meeting:get': true,
  'meeting:addNote': true,
  'meeting:updateNote': true,
  'meeting:deleteNote': true,
  'transcript:get': true,
  'transcript:start': true,
  'transcript:cancel': true,
  'transcript:renameSpeaker': true,
  'summary:get': true,
  'summary:start': true,
  'summary:cancel': true,
  'chat:get': true,
  'chat:send': true,
  'chat:stop': true,
  'chat:clear': true,
  'ai:getStatus': true,
  'ai:setKey': true,
  'ai:clearKey': true,
  'ai:testKey': true,
  'app:openExternal': true,
  'settings:get': true,
  'settings:update': true,
  'recovery:getReport': true,
  'recovery:retry': true,
  'floating:getInfo': true,
  'floating:resize': true,
  'floating:showMain': true,
  'notes:openEditor': true,
  'notes:begin': true,
  'notes:save': true,
  'notes:cancel': true
} as const satisfies Record<IpcChannel, true>

export const IPC_EVENTS = {
  'recording:state': true,
  'recording:level': true,
  'recovery:report': true,
  'floating:info': true,
  'notes:saved': true,
  'notes:opened': true,
  'transcript:changed': true,
  'summary:changed': true,
  'chat:event': true,
  'library:changed': true
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
