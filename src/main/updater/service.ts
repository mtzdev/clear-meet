import type { Result } from '@shared/recording'
import {
  canRestartForUpdate,
  IDLE_UPDATE_STATE,
  reduceUpdateState,
  UNAVAILABLE_UPDATE_STATE,
  type UpdateEvent,
  type UpdateState
} from '@shared/update'

/** O que o serviço precisa do atualizador; `electron.ts` liga isto ao `electron-updater`. */
export interface UpdateDriver {
  /** Recebe os eventos do atualizador (uma única inscrição). */
  subscribe(listener: (event: UpdateEvent) => void): void
  /** Procura uma versão nova; se houver, o download começa sozinho. */
  check(): Promise<void>
  /** Fecha o app e instala a versão baixada. */
  quitAndInstall(): void
}

export interface UpdaterDeps {
  /** `null` fora do app instalado: o serviço fica inativo. */
  driver: UpdateDriver | null
  /** Fase atual da gravação, para nunca reiniciar no meio dela. */
  recordingPhase(): Parameters<typeof canRestartForUpdate>[0]
  emit(state: UpdateState): void
  log?(message: string): void
  firstCheckDelayMs?: number
  intervalMs?: number
}

const FIRST_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export class UpdaterService {
  private state: UpdateState
  private timers: { first: NodeJS.Timeout | null; every: NodeJS.Timeout | null } = {
    first: null,
    every: null
  }

  constructor(private readonly deps: UpdaterDeps) {
    this.state = deps.driver ? IDLE_UPDATE_STATE : UNAVAILABLE_UPDATE_STATE
    deps.driver?.subscribe((event) => this.apply(event))
  }

  getState(): UpdateState {
    return this.state
  }

  /** Primeira checagem alguns segundos depois de abrir e depois a cada ~6 h. */
  start(): void {
    if (!this.deps.driver || this.timers.first || this.timers.every) return
    this.timers.first = setTimeout(
      () => void this.check(),
      this.deps.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS
    )
    this.timers.every = setInterval(
      () => void this.check(),
      this.deps.intervalMs ?? CHECK_INTERVAL_MS
    )
  }

  stop(): void {
    if (this.timers.first) clearTimeout(this.timers.first)
    if (this.timers.every) clearInterval(this.timers.every)
    this.timers = { first: null, every: null }
  }

  async check(): Promise<void> {
    const { driver } = this.deps
    // Com uma versão já baixada ou baixando, não há o que procurar.
    if (!driver || this.state.phase === 'ready' || this.state.phase === 'downloading') return
    try {
      await driver.check()
    } catch (error) {
      this.log(`checagem falhou: ${String(error)}`)
      this.apply({ type: 'error' })
    }
  }

  /** Reinicia para instalar a versão baixada. Recusa durante a gravação. */
  restart(): Result<null> {
    if (!this.deps.driver || this.state.phase !== 'ready') {
      return {
        ok: false,
        error: { code: 'not-found', message: 'Não há atualização pronta para instalar.' }
      }
    }
    if (!canRestartForUpdate(this.deps.recordingPhase())) {
      return {
        ok: false,
        error: { code: 'busy', message: 'Termine a gravação antes de reiniciar.' }
      }
    }
    this.log('reiniciando para instalar a atualização')
    this.deps.driver.quitAndInstall()
    return { ok: true, value: null }
  }

  private apply(event: UpdateEvent): void {
    if (event.type === 'error') this.log('o atualizador reportou um erro')
    const next = reduceUpdateState(this.state, event)
    if (next === this.state) return
    this.state = next
    this.deps.emit(next)
  }

  private log(message: string): void {
    this.deps.log?.(`[updater] ${message}`)
  }
}
