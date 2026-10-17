import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { thumbnailFileName } from '@shared/media'
import { renameWithRetry } from '../fs/atomic'
import { runProcess, type FfmpegTools, type RunProcess } from '../ffmpeg/media'

export const THUMBNAIL_WIDTH = 320
const FFMPEG_TIMEOUT_MS = 60_000
const DEFAULT_FRAME_MS = 3000

export interface ThumbnailJob {
  id: string
  videoPath: string
  durationMs: number | null
  /** Assinatura do Vídeo lido: devolvida no resultado para o índice saber para qual Vídeo valeu. */
  videoSig: string
}

export type ThumbnailOutcome = 'ok' | 'failed'

export interface ThumbnailQueueDeps {
  /** Pasta do cache (em `userData`, nunca na pasta da Reunião). */
  dir: string
  getTools(): Promise<FfmpegTools | null>
  /** Falso enquanto outra coisa pesada (a gravação) precisa da máquina; `kick()` retoma. */
  canRun(): boolean
  onDone(job: ThumbnailJob, outcome: ThumbnailOutcome): void
  run?: RunProcess
  log?(message: string): void
}

/** Instante do quadro: ~10% do Vídeo (3 s se a duração é desconhecida), sempre dentro dele. */
export function frameOffsetMs(durationMs: number | null): number {
  if (durationMs === null || durationMs <= 0) return DEFAULT_FRAME_MS
  return Math.max(0, Math.min(durationMs * 0.1, durationMs - 500))
}

export function thumbnailPath(dir: string, id: string): string {
  return join(dir, thumbnailFileName(id))
}

/**
 * Fila de miniaturas: uma por vez, na ordem em que foram enfileiradas (quem enfileira manda as
 * Reuniões mais recentes antes), e só enquanto `canRun()` deixa. Gera um JPEG pequeno com o FFmpeg.
 */
export class ThumbnailQueue {
  private readonly pending = new Map<string, ThumbnailJob>()
  private working: Promise<void> | null = null
  private current: ThumbnailJob | null = null

  constructor(private readonly deps: ThumbnailQueueDeps) {}

  /** Acrescenta trabalhos (um por Reunião; um novo substitui o antigo) e começa se estiver parada. */
  enqueue(jobs: readonly ThumbnailJob[]): void {
    for (const job of jobs) {
      if (this.current?.id === job.id && this.current.videoSig === job.videoSig) continue
      this.pending.delete(job.id)
      this.pending.set(job.id, job)
    }
    this.kick()
  }

  remove(id: string): void {
    this.pending.delete(id)
  }

  get size(): number {
    return this.pending.size
  }

  /** Nada na fila e nada sendo gerado agora. */
  get isIdle(): boolean {
    return this.working === null && this.pending.size === 0
  }

  kick(): void {
    if (this.working || this.pending.size === 0 || !this.deps.canRun()) return
    this.working = this.drain().finally(() => {
      this.working = null
    })
  }

  /** Resolve quando a fila esvazia ou para (para os testes). */
  async idle(): Promise<void> {
    while (this.working) await this.working
  }

  private async drain(): Promise<void> {
    while (this.deps.canRun()) {
      const next = this.pending.values().next()
      if (next.done) return
      const job = next.value
      this.pending.delete(job.id)
      this.current = job
      const tools = await this.deps.getTools()
      if (!tools) {
        // Sem FFmpeg: nada a fazer agora; a próxima varredura enfileira de novo.
        this.pending.clear()
        this.current = null
        return
      }
      let outcome: ThumbnailOutcome = 'failed'
      try {
        outcome = (await this.generate(tools, job)) ? 'ok' : 'failed'
      } catch (error) {
        this.deps.log?.(`[miniaturas] ${error instanceof Error ? error.message : String(error)}`)
      }
      this.deps.onDone(job, outcome)
      this.current = null
    }
  }

  private async generate(tools: FfmpegTools, job: ThumbnailJob): Promise<boolean> {
    await mkdir(this.deps.dir, { recursive: true })
    const target = thumbnailPath(this.deps.dir, job.id)
    const temp = target.replace(/\.jpg$/, '.tmp.jpg')
    const run = this.deps.run ?? runProcess
    const offsets = [frameOffsetMs(job.durationMs), 0]
    try {
      for (const offset of [...new Set(offsets)]) {
        const result = await run(
          tools.ffmpegPath,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-nostdin',
            '-y',
            '-ss',
            (offset / 1000).toFixed(3),
            '-i',
            job.videoPath,
            '-frames:v',
            '1',
            '-vf',
            `scale=${THUMBNAIL_WIDTH}:-2`,
            '-q:v',
            '5',
            temp
          ],
          { timeoutMs: FFMPEG_TIMEOUT_MS }
        )
        if (result.code === 0 && (await fileSize(temp)) > 0) {
          await renameWithRetry(temp, target)
          return true
        }
      }
      return false
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/** Apaga a miniatura de uma Reunião (best effort). */
export async function removeThumbnail(dir: string, id: string): Promise<void> {
  await rm(thumbnailPath(dir, id), { force: true }).catch(() => undefined)
}

/** Apaga do cache os JPEGs que não são de nenhuma das Reuniões em `keepIds`, e temporários. */
export async function removeOrphanThumbnails(
  dir: string,
  keepIds: Iterable<string>
): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const keep = new Set([...keepIds].map(thumbnailFileName))
  await Promise.all(
    names
      .filter((name) => !keep.has(name))
      .map((name) => rm(join(dir, name), { force: true }).catch(() => undefined))
  )
}
