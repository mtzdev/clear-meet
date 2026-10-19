import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isContentArea, type ContentArea } from '@shared/content-area'
import { MEETING_FILES } from '@shared/meeting'
import { writeFileAtomic } from '../fs/atomic'
import type { FfmpegTools, RunProcess } from '../ffmpeg/media'
import { isDirectChild, readMeeting } from '../meetings/repository'
import { detectContentArea } from './detect'

export interface ContentAreaDeps {
  meetingsDir(): string
  /** Cache em `userData`, nunca na pasta da Reunião. */
  cacheDir: string
  getTools(): Promise<FfmpegTools | null>
  /** Falso durante a gravação: a detecção espera (nada é guardado) e o player usa o quadro inteiro. */
  canRun(): boolean
  run?: RunProcess
  log?(message: string): void
}

interface Cached {
  sig: string
  area: ContentArea | null
}

/** Assinatura do arquivo de Vídeo: muda quando a Compactação o troca. */
async function videoSignature(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? `${info.size}:${Math.round(info.mtimeMs)}` : null
  } catch {
    return null
  }
}

/**
 * Área útil (sem faixas pretas) do Vídeo de cada Reunião, medida uma vez por arquivo em segundo
 * plano e guardada em cache. Uma medida por vez; pedidos repetidos da mesma pasta se juntam.
 */
export class ContentAreaService {
  private readonly inFlight = new Map<string, Promise<ContentArea | null>>()
  private chain: Promise<unknown> = Promise.resolve()
  private controller = new AbortController()

  constructor(private readonly deps: ContentAreaDeps) {}

  get(folder: string): Promise<ContentArea | null> {
    if (!isDirectChild(this.deps.meetingsDir(), folder)) return Promise.resolve(null)
    const pending = this.inFlight.get(folder)
    if (pending) return pending
    const task = this.chain.then(() => this.resolve(folder, this.controller.signal))
    const tracked = task
      .catch((error: unknown) => {
        this.deps.log?.(
          `[área útil] ${error instanceof Error ? error.message : String(error)} (${folder})`
        )
        return null
      })
      .finally(() => this.inFlight.delete(folder))
    this.inFlight.set(folder, tracked)
    this.chain = tracked
    return tracked
  }

  /** Cancela as medidas em curso e espera o FFmpeg soltar os arquivos (renomear, excluir, mover). */
  async release(): Promise<void> {
    this.controller.abort()
    this.controller = new AbortController()
    await this.chain
  }

  private async resolve(folder: string, signal: AbortSignal): Promise<ContentArea | null> {
    const video = join(folder, MEETING_FILES.video)
    const sig = await videoSignature(video)
    if (sig === null) return null
    const meeting = await readMeeting(folder)
    if (!meeting.ok) return null
    const cacheFile = join(this.deps.cacheDir, `${meeting.value.id}.json`)

    const cached = await this.readCache(cacheFile)
    if (cached?.sig === sig) return cached.area
    if (!this.deps.canRun() || signal.aborted) return null

    const tools = await this.deps.getTools()
    if (!tools) return null
    const area = await detectContentArea(tools, video, { run: this.deps.run, signal })
    if (signal.aborted) return null
    await this.writeCache(cacheFile, { sig, area })
    return area
  }

  private async readCache(file: string): Promise<Cached | null> {
    try {
      const data = JSON.parse(await readFile(file, 'utf8')) as Partial<Cached>
      if (typeof data.sig !== 'string') return null
      if (data.area !== null && !isContentArea(data.area)) return null
      return { sig: data.sig, area: data.area ?? null }
    } catch {
      return null
    }
  }

  private async writeCache(file: string, value: Cached): Promise<void> {
    try {
      await mkdir(this.deps.cacheDir, { recursive: true })
      await writeFileAtomic(file, JSON.stringify(value))
    } catch (error) {
      this.deps.log?.(
        `[área útil] não foi possível guardar o cache: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
