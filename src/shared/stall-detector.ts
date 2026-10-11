/** Sem quadros por mais que isto, o Vídeo é considerado congelado (janela minimizada, por exemplo). */
export const FRAME_STALL_THRESHOLD_MS = 2000

/**
 * Detecta a falta de quadros da fonte. A janela gravada minimizada para de
 * entregar quadros (ADR 0002); o Vídeo segura o último quadro e a UI avisa.
 * O relógio é passado de fora (`now`), então a lógica é determinística nos testes.
 */
export class FrameStallDetector {
  private lastFrameAt: number
  private paused = false
  private stalled = false

  constructor(
    start: number,
    private readonly thresholdMs: number = FRAME_STALL_THRESHOLD_MS
  ) {
    this.lastFrameAt = start
  }

  onFrame(now: number): void {
    this.lastFrameAt = now
  }

  /**
   * Durante a pausa não há o que avisar; ao retomar, a contagem recomeça do zero.
   * Devolve `false` se havia um aviso ativo que a pausa desfez, senão `null`.
   */
  setPaused(paused: boolean, now: number): false | null {
    this.paused = paused
    if (!paused) {
      this.lastFrameAt = now
      return null
    }
    const cleared = this.stalled
    this.stalled = false
    return cleared ? false : null
  }

  /**
   * Reavalia no instante `now`. Devolve o novo estado só quando ele muda
   * (`true` = congelou, `false` = voltou), senão `null`.
   */
  check(now: number): boolean | null {
    const stalled = !this.paused && now - this.lastFrameAt > this.thresholdMs
    if (stalled === this.stalled) return null
    this.stalled = stalled
    return stalled
  }
}
