/** Sem bytes do gravador de vídeo por mais que isto (com quadros sendo entregues) = codificador travado. */
export const VIDEO_STALL_THRESHOLD_MS = 20_000
/**
 * Os quadros precisam estar chegando ao codificador nesta janela para a falta de bytes contar
 * como travamento. Também é o tamanho da lacuna sem quadros que "zera" a contagem de bytes.
 */
const FEED_WINDOW_MS = 5_000

/**
 * Detecta o travamento do codificador de vídeo: o canvas continua entregando quadros ao
 * `MediaRecorder`, mas ele não emite mais bytes. O MP4 fragmentado entrega dados a cada ~7 s,
 * então 20 s sem nada é um sinal confiável. Se não há quadros chegando ao codificador, a falta
 * de bytes é esperada e não conta, e o primeiro quadro depois de uma lacuna recomeça a contagem
 * (o gravador não tinha o que emitir durante ela). O relógio vem de fora (`now`).
 */
export class VideoEncoderWatchdog {
  private lastDataAt: number
  private lastFeedAt = Number.NEGATIVE_INFINITY
  private paused = false
  private stalled = false

  constructor(
    start: number,
    private readonly thresholdMs: number = VIDEO_STALL_THRESHOLD_MS
  ) {
    this.lastDataAt = start
  }

  /** O gravador de vídeo entregou bytes. */
  onData(now: number): void {
    this.lastDataAt = now
  }

  /** Um quadro foi entregue ao gravador de vídeo. */
  onFeed(now: number): void {
    // Voltou de uma lacuna sem quadros: o silêncio de bytes nela não é travamento.
    if (now - this.lastFeedAt > FEED_WINDOW_MS) this.lastDataAt = now
    this.lastFeedAt = now
  }

  /** Pausada, o gravador não emite nada; ao retomar, a contagem recomeça. */
  setPaused(paused: boolean, now: number): false | null {
    this.paused = paused
    if (!paused) {
      this.lastDataAt = now
      return null
    }
    const cleared = this.stalled
    this.stalled = false
    return cleared ? false : null
  }

  /** Reavalia; devolve o novo estado só quando muda (`true` = travou, `false` = voltou). */
  check(now: number): boolean | null {
    const stalled =
      !this.paused &&
      now - this.lastDataAt > this.thresholdMs &&
      now - this.lastFeedAt < FEED_WINDOW_MS
    if (stalled === this.stalled) return null
    this.stalled = stalled
    return stalled
  }
}
