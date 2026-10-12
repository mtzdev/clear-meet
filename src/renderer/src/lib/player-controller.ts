import { useSyncExternalStore } from 'react'
import { clampInstant, seekBy, timelineDurationMs } from '@shared/timeline'

export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const

export interface PlayerSnapshot {
  currentMs: number
  /** Duração da linha do tempo (ms): a do arquivo, ou a do `meeting.json` enquanto não carrega. */
  durationMs: number
  paused: boolean
  rate: number
  muted: boolean
  error: string | null
}

/** Atualização da posição durante a reprodução (ms): ~20 quadros por segundo bastam. */
const FRAME_INTERVAL_MS = 50

const EVENTS = [
  'loadedmetadata',
  'durationchange',
  'timeupdate',
  'seeking',
  'seeked',
  'play',
  'pause',
  'ended',
  'ratechange',
  'volumechange',
  'error'
] as const

/**
 * Controla o `<video>` / `<audio>` da Reunião fora do React: a UI se inscreve nas mudanças
 * (`useSyncExternalStore`) e só renderiza o que mudou. A posição é o Instante em ms.
 * Pedidos de seek antes de o arquivo carregar ficam guardados e são aplicados ao carregar.
 */
export class PlayerController {
  private element: HTMLMediaElement | null = null
  private snapshot: PlayerSnapshot
  private readonly listeners = new Set<() => void>()
  private pendingSeekMs: number | null = null
  private resumePlaying = false
  private frame = 0
  private lastFrameAt = 0
  private rate = 1
  private muted = false

  constructor(private readonly fallbackDurationMs: number | null) {
    this.snapshot = {
      currentMs: 0,
      durationMs: timelineDurationMs(Number.NaN, fallbackDurationMs),
      paused: true,
      rate: 1,
      muted: false,
      error: null
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): PlayerSnapshot => this.snapshot

  private publish(patch: Partial<PlayerSnapshot>): void {
    const next = { ...this.snapshot, ...patch }
    const changed = (Object.keys(next) as (keyof PlayerSnapshot)[]).some(
      (key) => next[key] !== this.snapshot[key]
    )
    if (!changed) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  readonly attach = (element: HTMLMediaElement | null): void => {
    if (this.element === element) return
    if (this.element) {
      for (const name of EVENTS) this.element.removeEventListener(name, this.onEvent)
    }
    this.stopFrames()
    this.element = element
    if (!element) return
    for (const name of EVENTS) element.addEventListener(name, this.onEvent)
    this.sync()
  }

  private readonly onEvent = (event: Event): void => {
    const element = this.element
    if (!element) return
    switch (event.type) {
      case 'loadedmetadata':
        this.applyAfterLoad(element)
        break
      case 'play':
        this.startFrames()
        break
      case 'pause':
      case 'ended':
        this.stopFrames()
        break
      case 'error':
        // Sem `src` (mídia liberada de propósito) não é falha.
        if (element.hasAttribute('src')) {
          this.publish({ error: 'Não foi possível reproduzir este arquivo.' })
        }
        return
    }
    this.sync()
  }

  /** Metadados carregados: aplica o seek pedido antes, a velocidade e o mudo. */
  private applyAfterLoad(element: HTMLMediaElement): void {
    element.playbackRate = this.rate
    element.muted = this.muted
    if (this.pendingSeekMs !== null) {
      element.currentTime = clampInstant(this.pendingSeekMs, this.durationMs()) / 1000
      this.pendingSeekMs = null
    }
    if (this.resumePlaying) {
      this.resumePlaying = false
      void element.play().catch(() => undefined)
    }
    this.publish({ error: null })
  }

  private durationMs(): number {
    return timelineDurationMs(this.element?.duration ?? Number.NaN, this.fallbackDurationMs)
  }

  private sync(): void {
    const element = this.element
    if (!element) return
    // Com seek pendente (arquivo ainda carregando) a posição mostrada é a pedida.
    const currentMs =
      this.pendingSeekMs !== null ? this.pendingSeekMs : Math.round(element.currentTime * 1000)
    this.publish({
      currentMs,
      durationMs: this.durationMs(),
      paused: element.paused,
      rate: element.playbackRate,
      muted: element.muted
    })
  }

  private startFrames(): void {
    if (this.frame !== 0) return
    const tick = (now: number): void => {
      if (now - this.lastFrameAt >= FRAME_INTERVAL_MS) {
        this.lastFrameAt = now
        this.sync()
      }
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  private stopFrames(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  /** Leva o player ao Instante `ms` (mantém tocando ou pausado como estava). */
  seekToMs(ms: number): void {
    const target = clampInstant(ms, this.durationMs())
    const element = this.element
    if (!element || element.readyState === 0) {
      this.pendingSeekMs = target
      this.publish({ currentMs: target })
      return
    }
    element.currentTime = target / 1000
    this.publish({ currentMs: target })
  }

  skip(deltaMs: number): void {
    this.seekToMs(seekBy(this.snapshot.currentMs, deltaMs, this.durationMs()))
  }

  togglePlay(): void {
    const element = this.element
    if (!element) return
    if (element.paused) void element.play().catch(() => undefined)
    else element.pause()
  }

  setRate(rate: number): void {
    this.rate = rate
    if (this.element) this.element.playbackRate = rate
    this.sync()
  }

  toggleMuted(): void {
    this.muted = !this.muted
    if (this.element) this.element.muted = this.muted
    this.sync()
  }

  /**
   * Solta o arquivo (para a pasta poder ser renomeada no Windows) guardando a posição e se
   * estava tocando; ao receber o `src` de novo, o player volta ao mesmo ponto.
   */
  release(): void {
    const element = this.element
    if (!element) return
    if (this.pendingSeekMs === null) this.pendingSeekMs = Math.round(element.currentTime * 1000)
    this.resumePlaying = this.resumePlaying || !element.paused
    element.pause()
    element.removeAttribute('src')
    element.load()
    this.stopFrames()
    this.publish({ paused: true, currentMs: this.pendingSeekMs })
  }
}

/** Valor derivado do estado do player; o `select` deve devolver um primitivo (comparado com `Object.is`). */
export function usePlayerValue<T>(
  controller: PlayerController,
  select: (snapshot: PlayerSnapshot) => T
): T {
  return useSyncExternalStore(controller.subscribe, () => select(controller.getSnapshot()))
}
