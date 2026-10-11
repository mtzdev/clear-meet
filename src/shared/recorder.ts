import type { QualityPreset } from './capture'
import type { MicSelection } from './recording'

/**
 * Contrato entre o main e a janela de gravação (oculta). A captura vive nela, não na
 * UI: a janela principal pode recarregar ou sumir sem afetar a gravação.
 * Fluxo: o main envia comandos (`recorder:command`), a janela responde (`recorder:reply`),
 * entrega pedaços (`recorder:chunk`) e avisa eventos (`recorder:event`).
 */

export interface RecorderStartParams {
  /** `false` na Reunião só de áudio. */
  hasVideo: boolean
  mic: MicSelection | null
  preset: QualityPreset
  /** Compactação ligada define o bitrate ao vivo (ADR 0003). */
  compaction: boolean
  /**
   * Avisar quando a fonte parar de enviar quadros. Só faz sentido para janelas: uma tela
   * parada (nada mudando) também não envia quadros, e isso não é problema.
   */
  watchStalls: boolean
}

export interface RecorderStarted {
  /** Tempo (ms desde 1970) do `onstart` do gravador de **áudio** = Instante zero. */
  startedAt: number
  /** Dados do Vídeo gravado; `null` se não há Vídeo. */
  video: {
    width: number
    height: number
    fps: number
    mimeType: string
    bitsPerSecond: number
    /** Tamanho da fonte no início (informativo). */
    sourceWidth: number
    sourceHeight: number
  } | null
  audioMimeType: string
  hasMic: boolean
  /** O `getDisplayMedia` entregou uma track de áudio (loopback do sistema). */
  hasSystemAudio: boolean
  /** Por que o microfone não entrou (permissão, dispositivo ausente…); `null` se entrou ou não foi pedido. */
  micProblem: string | null
}

export interface LimiterCheckResult {
  /** Pico (dBFS) do mix de duas fontes a 0 dBFS, sem e com o limitador. */
  rawPeakDbfs: number
  limitedPeakDbfs: number
}

export type RecorderCommand =
  | { name: 'start'; params: RecorderStartParams }
  | { name: 'pause' }
  | { name: 'resume' }
  | { name: 'stop' }
  /** Só para a verificação em desenvolvimento: mede o limitador do mix. */
  | { name: 'limiter-check' }

export type RecorderCommandName = RecorderCommand['name']

export interface RecorderResults {
  start: RecorderStarted
  pause: { at: number }
  resume: { at: number }
  stop: null
  'limiter-check': LimiterCheckResult
}

export interface RecorderCommandMessage {
  id: number
  command: RecorderCommand
}

export type RecorderReply =
  | { id: number; ok: true; result: RecorderResults[RecorderCommandName] }
  | { id: number; ok: false; error: string }

export type RecorderEvent =
  | { type: 'ready' }
  | { type: 'levels'; mic: number; system: number }
  /** `true` = a fonte parou de enviar quadros (janela minimizada); `false` = voltou. */
  | { type: 'frames-stalled'; stalled: boolean }
  /** `true` = o codificador de vídeo travou (quadros entram, nenhum byte sai); `false` = voltou. */
  | { type: 'video-stalled'; stalled: boolean }
  /** A track de vídeo terminou (janela fechada, tela desconectada). */
  | { type: 'source-ended' }
  | { type: 'error'; message: string }

export type RecorderChunkKind = 'video' | 'audio'

/** API exposta à janela de gravação em `window.recorderBridge` (preload `recorder.ts`). */
export interface RecorderBridge {
  onCommand(handler: (message: RecorderCommandMessage) => void): void
  reply(reply: RecorderReply): void
  /** Entrega um pedaço; resolve quando o main o escreveu em disco. */
  sendChunk(kind: RecorderChunkKind, data: ArrayBuffer): Promise<void>
  sendEvent(event: RecorderEvent): void
}

export const RECORDER_CHANNELS = {
  command: 'recorder:command',
  reply: 'recorder:reply',
  chunk: 'recorder:chunk',
  event: 'recorder:event'
} as const
