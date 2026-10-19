import { rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  needsCompaction,
  type CompactionChangedEvent,
  type CompactionMeta,
  type CompactionMode,
  type ListCompaction
} from '@shared/compaction'
import type { ContentArea } from '@shared/content-area'
import { MEETING_FILES } from '@shared/meeting'
import type { RecordingError, RecordingState, Result } from '@shared/recording'
import {
  probeMedia,
  runProcess,
  type FfmpegTools,
  type MediaInfo,
  type RunProcess
} from '../ffmpeg/media'
import { renameWithRetry } from '../fs/atomic'
import { updateCompactionMeta } from '../meetings/compaction-store'
import { findMeetingFolder } from '../meetings/library'
import { isDirectChild, listMeetingFolders, readMeeting } from '../meetings/repository'
import { buildCompactionArgs } from './args'
import type { Av1Encoder } from './encoders'
import { runCompression, type RunCompression } from './run'
import { validateCompacted } from './validate'

const DEFAULT_REPLACE_RETRY_MS = 30_000
const DEFAULT_MAX_REPLACE_ATTEMPTS = 40
const SOFTWARE_ENCODER: Av1Encoder = 'libsvtav1'

export interface CompactionDeps {
  meetingsDir(): string
  getTools(): Promise<FfmpegTools | null>
  /** Compactação ligada nas configurações. */
  enabled(): boolean
  mode(): CompactionMode
  /** Falso enquanto outra coisa pesada (a gravação) precisa da máquina; `kick()` retoma. */
  canRun(): boolean
  detector: { get(tools: FfmpegTools): Promise<Av1Encoder | null> }
  /** Área útil do Vídeo (sem faixas pretas); sem ela, o quadro inteiro é codificado. */
  contentArea?: { get(folder: string): Promise<ContentArea | null> }
  emit(event: CompactionChangedEvent): void
  /** A pasta mudou no disco: o índice deve relê-la. */
  onFolderChanged(folder: string): void
  run?: RunProcess
  runCompression?: RunCompression
  /** Troca o arquivo compactado pelo original; falha enquanto outro programa usa o original. */
  rename?: (from: string, to: string) => Promise<void>
  replaceRetryMs?: number
  maxReplaceAttempts?: number
  now(): number
  log(message: string): void
}

interface Job {
  id: string
  folder: string
  /** Pedido do usuário (tentar de novo): ignora o estado guardado. */
  force: boolean
}

interface Running {
  job: Job
  folder: string
  controller: AbortController
}

interface AwaitingSwap {
  job: Job
  folder: string
  temp: string
  target: string
  encoder: Av1Encoder
  originalBytes: number
  finalBytes: number
  attempts: number
  timer: ReturnType<typeof setTimeout> | null
}

type Outcome = 'finished' | 'paused' | 'skipped'

function key(folder: string): string {
  const resolved = resolve(folder)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function hasAv1Video(info: MediaInfo): boolean {
  return info.streams.some((stream) => stream.type === 'video' && stream.codec === 'av1')
}

/**
 * Compactação do Vídeo em segundo plano: uma Reunião por vez, em prioridade baixa e só enquanto
 * `canRun()` deixa. O arquivo novo é validado e só entra no lugar do `video.mp4` se ficar menor;
 * a pasta nunca fica sem um `video.mp4` válido.
 */
export class CompactionService {
  private readonly queue = new Map<string, Job>()
  private readonly waiting = new Map<string, AwaitingSwap>()
  private running: Running | null = null
  private working: Promise<void> | null = null
  private percent = 0

  constructor(private readonly deps: CompactionDeps) {}

  /** Em andamento (compactando ou esperando o arquivo ser liberado): a pasta não pode ser mexida. */
  isActive(folder: string): boolean {
    const wanted = key(folder)
    return (
      (this.running !== null && key(this.running.folder) === wanted) || this.waiting.has(wanted)
    )
  }

  get isIdle(): boolean {
    return this.working === null && this.queue.size === 0 && this.waiting.size === 0
  }

  /** Resolve quando a fila esvazia ou para (para os testes). */
  async idle(): Promise<void> {
    while (this.working) await this.working
  }

  /**
   * Ao abrir o app: apaga temporários de uma Compactação interrompida, devolve essas Reuniões à
   * fila e enfileira as que ainda não foram compactadas (inclusive as antigas).
   */
  async start(): Promise<void> {
    for (const folder of await listMeetingFolders(this.deps.meetingsDir())) {
      await rm(join(folder, MEETING_FILES.videoCompacting), { force: true }).catch(() => undefined)
      const read = await readMeeting(folder)
      if (read.ok && read.value.video?.compaction?.status === 'running') {
        await this.setMeta(folder, read.value.id, { status: 'pending' }, false)
      }
    }
    await this.scan()
  }

  /** Enfileira as Reuniões prontas com Vídeo que ainda não foram compactadas. */
  async scan(): Promise<void> {
    if (!this.deps.enabled()) return
    const folders = (await listMeetingFolders(this.deps.meetingsDir())).sort().reverse()
    for (const folder of folders) await this.enqueueFolder(folder)
  }

  /** Enfileira uma Reunião (fim da gravação, Recuperação) se ela ainda precisa de Compactação. */
  async enqueueFolder(folder: string): Promise<void> {
    if (!this.deps.enabled() || this.isActive(folder) || this.queue.has(key(folder))) return
    const read = await readMeeting(folder)
    if (!read.ok) return
    const { video, status } = read.value
    if (status !== 'ready' || !video || !needsCompaction(video.compaction)) return
    this.queue.set(key(folder), { id: read.value.id, folder, force: false })
    this.kick()
  }

  /** Tenta de novo uma Compactação que falhou. */
  async retry(folder: string): Promise<Result<null>> {
    if (!isDirectChild(this.deps.meetingsDir(), folder)) {
      return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    }
    if (!this.deps.enabled()) {
      return fail('invalid-request', 'A Compactação está desligada nas Configurações.')
    }
    if (this.isActive(folder)) return fail('busy', 'O Vídeo já está sendo compactado.')
    const read = await readMeeting(folder)
    if (!read.ok || read.value.status !== 'ready' || !read.value.video) {
      return fail('not-found', 'A Reunião não tem Vídeo para compactar.')
    }
    await this.setMeta(folder, read.value.id, { status: 'pending' }, false)
    this.queue.set(key(folder), { id: read.value.id, folder, force: true })
    this.kick()
    return { ok: true, value: null }
  }

  /** A gravação começou: interrompe a Compactação em curso (volta para a fila). Terminou: retoma. */
  onRecordingState(state: RecordingState): void {
    if (state.phase !== 'idle') {
      this.running?.controller.abort()
      return
    }
    if (state.finished?.status === 'ready' && state.finished.hasVideo) {
      void this.enqueueFolder(state.finished.folder)
    }
    this.kick()
  }

  /** Liga ou desliga na hora; desligar não desfaz nada já compactado. */
  onSettingsChanged(): void {
    if (this.deps.enabled()) {
      void this.scan()
      return
    }
    this.queue.clear()
    this.running?.controller.abort()
  }

  /**
   * Larga os arquivos das Reuniões: para a Compactação em curso (a Reunião volta para a fila) e
   * desiste das trocas que esperam um arquivo em uso. Quem pausa faz `canRun()` devolver falso e
   * chama `kick()` ao terminar.
   */
  async pause(): Promise<void> {
    this.running?.controller.abort()
    for (const [id, wait] of [...this.waiting]) {
      if (wait.timer) clearTimeout(wait.timer)
      this.waiting.delete(id)
      await rm(wait.temp, { force: true }).catch(() => undefined)
      await this.setMeta(wait.folder, wait.job.id, { status: 'pending' }, false)
      this.queue.set(id, { ...wait.job, force: false })
    }
    await this.idle()
  }

  /** Fim do app: para o FFmpeg e desiste de trocas pendentes (o temporário some na próxima abertura). */
  abortAll(): void {
    this.queue.clear()
    this.running?.controller.abort()
    for (const wait of this.waiting.values()) {
      if (wait.timer) clearTimeout(wait.timer)
    }
    this.waiting.clear()
  }

  kick(): void {
    if (this.working || this.queue.size === 0 || !this.canWork()) return
    this.working = this.drain().finally(() => {
      this.working = null
    })
  }

  private canWork(): boolean {
    return this.deps.enabled() && this.deps.canRun()
  }

  private async drain(): Promise<void> {
    while (this.canWork()) {
      const next = this.queue.entries().next()
      if (next.done) return
      const [id, job] = next.value
      this.queue.delete(id)
      let outcome: Outcome = 'skipped'
      try {
        outcome = await this.process(job)
      } catch (error) {
        this.deps.log(
          `[compactação] ${error instanceof Error ? error.message : String(error)} (${job.folder})`
        )
      }
      if (outcome === 'paused' && this.deps.enabled()) {
        this.queue.set(id, { ...job, force: false })
      }
    }
  }

  private async resolveFolder(job: Job): Promise<string | null> {
    if (await isDirectory(job.folder)) return job.folder
    // A pasta foi renomeada enquanto esperava na fila.
    return findMeetingFolder(this.deps.meetingsDir(), job.id)
  }

  private async process(job: Job): Promise<Outcome> {
    const folder = await this.resolveFolder(job)
    if (!folder) return 'skipped'
    const read = await readMeeting(folder)
    if (!read.ok || read.value.status !== 'ready' || !read.value.video) return 'skipped'
    if (!job.force && !needsCompaction(read.value.video.compaction)) return 'skipped'
    const target = join(folder, MEETING_FILES.video)
    const originalBytes = await fileSize(target)
    if (originalBytes === 0) return 'skipped'
    const tools = await this.deps.getTools()
    if (!tools) return 'skipped'

    const running: Running = { job, folder, controller: new AbortController() }
    this.running = running
    this.percent = 0
    try {
      await this.setMeta(folder, job.id, { status: 'running' }, true, 0)
      return await this.compact(running, tools, target, originalBytes)
    } finally {
      this.running = null
    }
  }

  private async compact(
    running: Running,
    tools: FfmpegTools,
    target: string,
    originalBytes: number
  ): Promise<Outcome> {
    const { job, folder } = running
    const temp = join(folder, MEETING_FILES.videoCompacting)
    const run = this.deps.run ?? runProcess
    try {
      let original: MediaInfo
      try {
        original = await probeMedia(tools, target, run)
      } catch (error) {
        return await this.fail(running, `Não foi possível ler o Vídeo: ${describe(error)}`)
      }
      if (hasAv1Video(original)) {
        // Já compactado (por uma versão anterior ou fora do app).
        await this.setMeta(folder, job.id, {
          status: 'done',
          codec: 'av1',
          originalBytes,
          finalBytes: originalBytes
        })
        return 'finished'
      }
      const durationMs = (original.durationSec ?? 0) * 1000
      if (durationMs <= 0) return await this.fail(running, 'Não foi possível medir a duração.')

      const preferred = await this.deps.detector.get(tools)
      if (!preferred) return await this.fail(running, 'O FFmpeg instalado não tem encoder AV1.')

      // Hardware que falha no meio do caminho não deve impedir a Compactação: cai para a CPU.
      const attempts: Av1Encoder[] =
        preferred === SOFTWARE_ENCODER ? [preferred] : [preferred, SOFTWARE_ENCODER]
      let lastReason = ''
      for (const encoder of attempts) {
        await rm(temp, { force: true })
        const attempt = await this.encode(running, tools, original, durationMs, temp, encoder)
        if (attempt === 'paused') {
          await this.setMeta(folder, job.id, { status: 'pending' })
          return 'paused'
        }
        if (attempt.ok) {
          return await this.finish(running, encoder, temp, target, originalBytes)
        }
        lastReason = attempt.reason
        this.deps.log(`[compactação] ${encoder} não serviu: ${attempt.reason}`)
      }
      return await this.fail(running, `Falha ao compactar: ${lastReason}`)
    } finally {
      if (!this.waiting.has(key(folder))) await rm(temp, { force: true }).catch(() => undefined)
    }
  }

  /** Codifica e valida. `paused` = o sinal de parada chegou no meio. */
  private async encode(
    running: Running,
    tools: FfmpegTools,
    original: MediaInfo,
    durationMs: number,
    temp: string,
    encoder: Av1Encoder
  ): Promise<'paused' | { ok: true } | { ok: false; reason: string }> {
    const { job, folder, controller } = running
    const crop = await this.deps.contentArea?.get(folder).catch(() => null)
    const args = buildCompactionArgs({
      input: join(folder, MEETING_FILES.video),
      output: temp,
      encoder,
      mode: this.deps.mode(),
      hasAudio: original.streams.some((stream) => stream.type === 'audio'),
      crop
    })
    const result = await (this.deps.runCompression ?? runCompression)(tools.ffmpegPath, args, {
      signal: controller.signal,
      onProgress: (processedMs) => {
        const next = Math.min(99, Math.max(0, Math.floor((processedMs / durationMs) * 100)))
        if (next === this.percent) return
        this.percent = next
        this.publish(job.id, folder, 'running', next)
      }
    })
    if (result.aborted) return 'paused'
    if (result.code !== 0) return { ok: false, reason: lastLine(result.stderr) }
    const validation = await validateCompacted(tools, original, temp, this.deps.run ?? runProcess)
    return validation.ok ? { ok: true } : { ok: false, reason: validation.reason }
  }

  /** Regra "manter o menor" e troca segura do arquivo. */
  private async finish(
    running: Running,
    encoder: Av1Encoder,
    temp: string,
    target: string,
    originalBytes: number
  ): Promise<Outcome> {
    const { job, folder } = running
    const finalBytes = await fileSize(temp)
    if (finalBytes === 0) return await this.fail(running, 'O arquivo compactado ficou vazio.')
    if (finalBytes >= originalBytes) {
      await this.setMeta(folder, job.id, {
        status: 'kept-original',
        encoder,
        originalBytes,
        finalBytes
      })
      return 'finished'
    }
    this.percent = 100
    this.publish(job.id, folder, 'running', 100)
    const rename = this.deps.rename ?? ((from, to) => renameWithRetry(from, to))
    try {
      await rename(temp, target)
    } catch (error) {
      this.deps.log(`[compactação] arquivo em uso, tentará de novo: ${describe(error)}`)
      this.waitToSwap({ job, folder, temp, target, encoder, originalBytes, finalBytes })
      return 'finished'
    }
    await this.setMeta(folder, job.id, {
      status: 'done',
      codec: 'av1',
      encoder,
      originalBytes,
      finalBytes
    })
    return 'finished'
  }

  private waitToSwap(item: Omit<AwaitingSwap, 'attempts' | 'timer'>): void {
    const wait: AwaitingSwap = { ...item, attempts: 0, timer: null }
    this.waiting.set(key(item.folder), wait)
    this.armSwap(wait)
  }

  private armSwap(wait: AwaitingSwap): void {
    const timer = setTimeout(
      () => void this.trySwap(wait),
      this.deps.replaceRetryMs ?? DEFAULT_REPLACE_RETRY_MS
    )
    timer.unref()
    wait.timer = timer
  }

  private async trySwap(wait: AwaitingSwap): Promise<void> {
    const waitKey = key(wait.folder)
    if (this.waiting.get(waitKey) !== wait) return
    wait.attempts += 1
    const rename = this.deps.rename ?? ((from, to) => renameWithRetry(from, to))
    try {
      await rename(wait.temp, wait.target)
    } catch (error) {
      if (wait.attempts < (this.deps.maxReplaceAttempts ?? DEFAULT_MAX_REPLACE_ATTEMPTS)) {
        this.armSwap(wait)
        return
      }
      this.waiting.delete(waitKey)
      await rm(wait.temp, { force: true }).catch(() => undefined)
      this.deps.log(`[compactação] desistiu da troca: ${describe(error)}`)
      await this.setMeta(wait.folder, wait.job.id, {
        status: 'error',
        error: 'Não foi possível substituir o Vídeo: o arquivo está em uso.'
      })
      return
    }
    this.waiting.delete(waitKey)
    await this.setMeta(wait.folder, wait.job.id, {
      status: 'done',
      codec: 'av1',
      encoder: wait.encoder,
      originalBytes: wait.originalBytes,
      finalBytes: wait.finalBytes
    })
  }

  private async fail(running: Running, message: string): Promise<Outcome> {
    this.deps.log(`[compactação] ${message} (${running.folder})`)
    await this.setMeta(running.folder, running.job.id, { status: 'error', error: message })
    return 'finished'
  }

  /** Grava o estado no `meeting.json`, avisa a UI e pede ao índice que releia a pasta. */
  private async setMeta(
    folder: string,
    meetingId: string,
    fields: Omit<CompactionMeta, 'updatedAt'>,
    announce = true,
    percent: number | null = null
  ): Promise<void> {
    const meta: CompactionMeta = { ...fields, updatedAt: new Date(this.deps.now()).toISOString() }
    const saved = await updateCompactionMeta(folder, () => meta).catch((error: unknown) => {
      this.deps.log(`[compactação] não foi possível gravar o estado: ${describe(error)}`)
      return null
    })
    if (!saved) return
    if (announce) this.publish(meetingId, folder, meta.status, percent)
    this.deps.onFolderChanged(folder)
  }

  private publish(
    meetingId: string,
    folder: string,
    status: ListCompaction,
    percent: number | null
  ): void {
    this.deps.emit({ meetingId, folder, status, percent })
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  return lines[lines.length - 1]?.trim() ?? 'sem detalhes'
}
