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
