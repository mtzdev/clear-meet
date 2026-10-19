/** De onde veio o binário do FFmpeg em uso (ordem de resolução, da maior para a menor prioridade). */
export type FfmpegSource = 'env' | 'downloaded' | 'vendor'

/** Estado do FFmpeg/ffprobe, exibido em Configurações. */
export interface FfmpegStatus {
  /** `ffmpeg` e `ffprobe` encontrados e executáveis. */
  available: boolean
  source: FfmpegSource | null
  ffmpegPath: string | null
  ffprobePath: string | null
  /** Versão reportada por `ffmpeg -version` (ex.: `9.0.2-full_build-www.gyan.dev`). */
  version: string | null
  /** Encoder AV1 por CPU, usado na Compactação quando não há AV1 por hardware. */
  hasLibSvtAv1: boolean
  /** Versão fixada que o app baixa na primeira execução. */
  pinnedVersion: string
  /** Motivo, quando `available` é falso (binário ausente ou inválido). */
  error: string | null
}

export type FfmpegInstallPhase =
  'idle' | 'download' | 'verify' | 'extract' | 'validate' | 'done' | 'error'

/** Andamento da instalação do FFmpeg (download, verificação, extração). */
export interface FfmpegInstallState {
  phase: FfmpegInstallPhase
  receivedBytes: number
  /** `null` quando o servidor não informa o tamanho. */
  totalBytes: number | null
  /** Mensagem para o usuário, quando `phase` é `error`. */
  error: string | null
}

export const IDLE_FFMPEG_INSTALL: FfmpegInstallState = {
  phase: 'idle',
  receivedBytes: 0,
  totalBytes: null,
  error: null
}

/** Instalação em curso (baixando ou preparando os arquivos). */
export function isFfmpegInstalling(state: FfmpegInstallState): boolean {
  return (
    state.phase === 'download' ||
    state.phase === 'verify' ||
    state.phase === 'extract' ||
    state.phase === 'validate'
  )
}
