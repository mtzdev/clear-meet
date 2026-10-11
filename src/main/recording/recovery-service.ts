import type { RecoveryReport } from '@shared/recording'
import type { FfmpegTools, RunProcess } from '../ffmpeg/media'
import { recoverInterrupted } from './recovery'

export interface RecoveryServiceDeps {
  meetingsDir(): string
  getTools(): Promise<FfmpegTools | null>
  /** Pasta da Reunião em gravação agora (não deve ser tocada). */
  activeFolder(): string | null
  emit(report: RecoveryReport): void
  now(): number
  run?: RunProcess
  log?(message: string): void
}

/** Guarda o resultado da última varredura de gravações interrompidas e avisa a UI. */
export class RecoveryService {
  private report: RecoveryReport = { checkedAt: null, running: false, items: [] }
  private running: Promise<RecoveryReport> | null = null

  constructor(private readonly deps: RecoveryServiceDeps) {}

  getReport(): RecoveryReport {
    return this.report
  }

  /** Roda a varredura (uma por vez; chamadas simultâneas compartilham o resultado). */
  run(): Promise<RecoveryReport> {
    this.running ??= this.execute().finally(() => (this.running = null))
    return this.running
  }

  private async execute(): Promise<RecoveryReport> {
    this.report = { ...this.report, running: true }
    this.deps.emit(this.report)
    const active = this.deps.activeFolder()
    try {
      const items = await recoverInterrupted({
        meetingsDir: this.deps.meetingsDir(),
        getTools: () => this.deps.getTools(),
        skip: new Set(active ? [active] : []),
        ...(this.deps.run ? { run: this.deps.run } : {})
      })
      this.report = { checkedAt: this.deps.now(), running: false, items }
      for (const item of items) {
        const reason = item.reason ? ` (${item.reason})` : ''
        this.deps.log?.(`[recovery] ${item.outcome}: ${item.name}${reason}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.log?.(`[recovery] falhou: ${message}`)
      this.report = { checkedAt: this.deps.now(), running: false, items: [] }
    }
    this.deps.emit(this.report)
    return this.report
  }
}
