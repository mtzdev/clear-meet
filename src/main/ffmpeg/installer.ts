import { IDLE_FFMPEG_INSTALL, type FfmpegInstallState, type FfmpegStatus } from '@shared/ffmpeg'
import { installFfmpeg, type InstallOptions, type InstallProgress } from './install'
import { ChecksumMismatchError } from './verify'

export interface FfmpegInstallerDeps {
  /** Raiz das instalações baixadas (`<userData>/ffmpeg`). */
  destRoot: string
  getStatus(): Promise<FfmpegStatus>
  emit(state: FfmpegInstallState): void
  /** O FFmpeg ficou instalado e utilizável. */
  onInstalled(): void
  install?: (options: InstallOptions) => ReturnType<typeof installFfmpeg>
  now(): number
  log(message: string): void
}

/** Intervalo mínimo entre eventos de progresso do download. */
const PROGRESS_INTERVAL_MS = 150

/** Texto para o usuário; o motivo técnico vai só para o log. */
export function installErrorMessage(error: unknown): string {
  if (error instanceof ChecksumMismatchError) {
    return 'O arquivo baixado está corrompido. Tente de novo.'
  }
  const text = error instanceof Error ? error.message : String(error)
  if (/Falha no download \(\d+/.test(text)) {
    return 'O servidor recusou o download. Tente de novo mais tarde.'
  }
  if (/ENOSPC/.test(text)) return 'Não há espaço livre suficiente no disco.'
  return 'Não foi possível baixar o FFmpeg. Verifique a conexão e tente de novo.'
}

/**
 * Instalação do FFmpeg pelo app, uma por vez: quem pede enquanto outra roda recebe o estado
 * da que já está em andamento. Só instala quando o FFmpeg não está utilizável.
 */
export class FfmpegInstaller {
  private state: FfmpegInstallState = IDLE_FFMPEG_INSTALL
  private running: Promise<void> | null = null
  private lastEmitAt = 0

  constructor(private readonly deps: FfmpegInstallerDeps) {}

  getState(): FfmpegInstallState {
    return this.state
  }

  /** Começa a instalação (se preciso) e devolve o estado na hora; o andamento vai por evento. */
  start(): FfmpegInstallState {
    if (this.running) return this.state
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.state
  }

  /** Resolve quando a instalação em curso termina (para os testes). */
  async idle(): Promise<void> {
    await this.running
  }

  private set(state: FfmpegInstallState, force = true): void {
    this.state = state
    const now = this.deps.now()
    if (!force && now - this.lastEmitAt < PROGRESS_INTERVAL_MS) return
    this.lastEmitAt = now
    this.deps.emit(state)
  }

  private async run(): Promise<void> {
    this.set({ ...IDLE_FFMPEG_INSTALL, phase: 'download' })
    try {
      if ((await this.deps.getStatus()).available) {
        this.set({ ...this.state, phase: 'done' })
        return
      }
      await (this.deps.install ?? installFfmpeg)({
        destRoot: this.deps.destRoot,
        force: true,
        onProgress: (progress) => this.onProgress(progress)
      })
      if (!(await this.deps.getStatus()).available) {
        throw new Error('O FFmpeg instalado não passou na verificação')
      }
      this.set({ ...this.state, phase: 'done', error: null })
      this.deps.onInstalled()
    } catch (error) {
      this.deps.log(
        `[ffmpeg] falha na instalação: ${error instanceof Error ? error.message : String(error)}`
      )
      this.set({ ...this.state, phase: 'error', error: installErrorMessage(error) })
    }
  }

  private onProgress(progress: InstallProgress): void {
    if (progress.phase === 'download') {
      this.set(
        {
          phase: 'download',
          receivedBytes: progress.receivedBytes,
          totalBytes: progress.totalBytes,
          error: null
        },
        false
      )
      return
    }
    // `done` do instalador ainda precisa da checagem final de status.
    if (progress.phase === 'done') return
    this.set({ ...this.state, phase: progress.phase, error: null })
  }
}
