import type { QualityPreset } from './capture'
import type { ClockSnapshot } from './clock'
import type { CaptureSourceKind } from './meeting'

/** O que o usuário escolheu gravar. "Nenhuma" = Reunião só de áudio. */
export type CaptureSourceRef =
  { kind: 'screen' | 'window'; id: string; name: string } | { kind: 'none' }

/** Tela ou janela disponível para gravar, com miniatura para o seletor. */
export interface CaptureSourceInfo {
  id: string
  kind: 'screen' | 'window'
  name: string
  /** Data URL (JPEG) da miniatura; `null` se o Windows não entregou. */
  thumbnail: string | null
  /** Ícone do app dono da janela (data URL); só para janelas. */
  appIcon: string | null
}

export interface MicSelection {
  deviceId: string
  /** Rótulo do dispositivo: a janela de gravação o usa se o `deviceId` não for reconhecido. */
  label: string
}

export interface StartRecordingRequest {
  source: CaptureSourceRef
  /** `null` = sem microfone (só o áudio do sistema). */
  mic: MicSelection | null
  quality: QualityPreset
}

export type RecordingErrorCode =
  | 'busy'
  | 'not-recording'
  | 'no-disk-space'
  | 'source-unavailable'
  | 'recorder-failed'
  | 'invalid-request'
  | 'unknown'

export interface RecordingError {
  code: RecordingErrorCode
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: RecordingError }

/** Avisos ativos durante a gravação (a UI traduz o código em texto). */
export type RecordingWarning =
  'window-minimized' | 'low-disk' | 'mic-unavailable' | 'video-encoder-stalled'

export type StopReason =
  'user' | 'source-ended' | 'low-disk' | 'write-error' | 'recorder-crashed' | 'app-quit'

/** Dados da Reunião em gravação (iguais durante toda a sessão). */
export interface ActiveMeeting {
  meetingId: string
  /** Caminho absoluto da pasta da Reunião. */
  folder: string
  name: string
  source: { kind: CaptureSourceKind; name: string | null }
  quality: QualityPreset
  hasMic: boolean
  hasSystemAudio: boolean
  videoSize: { width: number; height: number } | null
}

/** Resultado de uma gravação encerrada; fica no estado até a UI confirmar (`acknowledge`). */
export interface FinishedRecording {
  meetingId: string
  folder: string
  name: string
  durationMs: number
  /** `ready`, ou `unprocessed` se o pós-processamento não pôde concluir (pedaços preservados). */
  status: 'ready' | 'unprocessed'
  hasVideo: boolean
  reason: StopReason
  /** Motivo de `unprocessed`, para exibir ao usuário. */
  issue: string | null
}

export type RecordingState =
  | { phase: 'idle'; finished: FinishedRecording | null }
  | { phase: 'starting' }
  | {
      phase: 'recording' | 'paused'
      meeting: ActiveMeeting
      clock: ClockSnapshot
      warnings: RecordingWarning[]
    }
  | { phase: 'finalizing'; meeting: ActiveMeeting; clock: ClockSnapshot }

export const IDLE_STATE: RecordingState = { phase: 'idle', finished: null }

/** O que o X da janela principal faz. */
export type MainWindowCloseAction = 'hide' | 'close'

/**
 * Durante a gravação (iniciando, gravando, pausada) o X só oculta a janela principal: a
 * barra continua e fechar o app por engano perderia o controle da gravação. Fora dela fecha
 * o app; na finalização também fecha (o app espera a finalização terminar antes de sair).
 */
export function mainWindowCloseAction(phase: RecordingState['phase']): MainWindowCloseAction {
  return phase === 'starting' || phase === 'recording' || phase === 'paused' ? 'hide' : 'close'
}

/** Níveis de pico (0 a 1) do microfone e do áudio do sistema, ~10 vezes por segundo. */
export interface AudioLevels {
  mic: number
  system: number
}

// --- Espaço em disco ---------------------------------------------------------------------------

const GB = 1024 ** 3
const MB = 1024 ** 2
/** Abaixo disto a UI avisa (1 h de gravação usa ~0,9 GB e pode chegar a ~1,8 GB no teto de 4 Mbps). */
export const DISK_LOW_BYTES = 2 * GB
/** Abaixo disto não inicia uma gravação nova. */
export const DISK_CRITICAL_BYTES = 300 * MB
/** Durante a gravação, abaixo disto ela é encerrada com segurança antes de o disco encher. */
export const DISK_ABORT_BYTES = 100 * MB

export type DiskLevel = 'ok' | 'low' | 'critical'

/** `null` (não foi possível medir) não bloqueia nada. */
export function assessDisk(freeBytes: number | null): DiskLevel {
  if (freeBytes === null) return 'ok'
  if (freeBytes < DISK_CRITICAL_BYTES) return 'critical'
  if (freeBytes < DISK_LOW_BYTES) return 'low'
  return 'ok'
}

export interface PreflightInfo {
  meetingsDir: string
  freeBytes: number | null
  disk: DiskLevel
  ffmpegAvailable: boolean
}

// --- Recuperação ----------------------------------------------------------------------------------

export type RecoveryOutcome =
  /** Reunião interrompida recuperada a partir dos pedaços; agora `ready`. */
  | 'recovered'
  /** Não deu para finalizar agora (ex.: FFmpeg ausente); os pedaços foram mantidos. */
  | 'pending'
  /** Não havia nada a recuperar (nenhum dado gravado); a pasta vazia foi removida. */
  | 'discarded'
  | 'failed'

export interface RecoveryItem {
  folder: string
  name: string
  outcome: RecoveryOutcome
  durationMs: number | null
  reason: string | null
}

export interface RecoveryReport {
  /** Quando a varredura terminou (ms); `null` enquanto não rodou. */
  checkedAt: number | null
  running: boolean
  items: RecoveryItem[]
}

// --- Pastas das Reuniões ---------------------------------------------------------------------------

export interface RenamedMeeting {
  folder: string
  name: string
  /** `false` se a pasta não pôde ser renomeada (arquivo em uso); o nome no `meeting.json` foi salvo. */
  folderRenamed: boolean
}
