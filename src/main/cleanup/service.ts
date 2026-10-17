import { join } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
import {
  cleanupCutoffMs,
  cleanupVerdict,
  type CleanupPreview,
  type CleanupRequest,
  type CleanupResult
} from '@shared/cleanup'
import type { MeetingListItem } from '@shared/library'
import { MEETING_FILES } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import { scanFolder } from '../library/scan'
import { fileBytes, trashMeetingFolder, trashMeetingVideo, type TrashItem } from '../meetings/trash'

export interface CleanupDeps {
  /** Reuniões iniciadas antes de `cutoffMs`, vindas do índice. */
  olderThan(cutoffMs: number): Promise<MeetingListItem[]>
  meetingsDir(): string
  /** Em uso por algo que só o main sabe (Conversa, Transcrição, Resumo, Compactação, gravação). */
  isBusy(folder: string): boolean
  trash: TrashItem
  /** O índice deve reler a pasta (a Reunião mudou ou sumiu). */
  refresh(folder: string): Promise<void>
  now(): number
  log(message: string): void
}

interface Planned {
  item: MeetingListItem
  bytes: number
}

interface Plan {
  planned: Planned[]
  skipped: number
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

/** Limpeza em lote por idade: o que vai para a Lixeira é calculado sobre os arquivos de verdade. */
export class CleanupService {
  private running = false

  constructor(private readonly deps: CleanupDeps) {}

  async preview(request: CleanupRequest): Promise<Result<CleanupPreview>> {
    try {
      const plan = await this.plan(request)
      return {
        ok: true,
        value: {
          count: plan.planned.length,
          bytes: plan.planned.reduce((sum, entry) => sum + entry.bytes, 0),
          skipped: plan.skipped,
          oldestDays: plan.planned.length === 0 ? await this.oldestDays() : null
        }
      }
    } catch (error) {
      this.deps.log(`[limpeza] ${error instanceof Error ? error.message : String(error)}`)
      return fail('unknown', 'Não foi possível calcular o espaço a liberar.')
    }
  }

  async run(request: CleanupRequest): Promise<Result<CleanupResult>> {
    if (this.running) return fail('busy', 'Já há uma Limpeza em andamento.')
    this.running = true
    try {
      const plan = await this.plan(request)
      const result: CleanupResult = { removed: 0, freedBytes: 0, skipped: plan.skipped, failed: 0 }
      for (const { item, bytes } of plan.planned) {
        // Entre a prévia e agora a Reunião pode ter começado a ser usada.
        if (this.deps.isBusy(item.folder)) {
          result.skipped += 1
          continue
        }
        const outcome = await this.remove(item, request, bytes)
        if (outcome === null) result.failed += 1
        else {
          result.removed += 1
          result.freedBytes += outcome
        }
        await this.deps.refresh(item.folder)
      }
      return { ok: true, value: result }
    } catch (error) {
      this.deps.log(`[limpeza] ${error instanceof Error ? error.message : String(error)}`)
      return fail('unknown', 'A Limpeza não pôde ser concluída.')
    } finally {
      this.running = false
    }
  }

  /** Bytes liberados, ou `null` se a Reunião não saiu do lugar. */
  private async remove(
    item: MeetingListItem,
    request: CleanupRequest,
    plannedBytes: number
  ): Promise<number | null> {
    const root = this.deps.meetingsDir()
    if (request.mode === 'video') {
      const result = await trashMeetingVideo(root, item.folder, this.deps.trash)
      return result.ok ? result.value.freedBytes : null
    }
    const result = await trashMeetingFolder(root, item.folder, this.deps.trash)
    return result.ok ? plannedBytes : null
  }

  private async plan(request: CleanupRequest): Promise<Plan> {
    const candidates = await this.deps.olderThan(
      cleanupCutoffMs(this.deps.now(), request.olderThanDays)
    )
    const planned: Planned[] = []
    let skipped = 0
    for (const item of candidates) {
      const verdict = cleanupVerdict(item, request.mode)
      if (verdict === 'ignore') continue
      if (verdict === 'busy' || this.deps.isBusy(item.folder)) {
        skipped += 1
        continue
      }
      const bytes = await this.bytesFor(item, request)
      if (bytes > 0) planned.push({ item, bytes })
    }
    return { planned, skipped }
  }

  private async oldestDays(): Promise<number | null> {
    const now = this.deps.now()
    const times = (await this.deps.olderThan(now))
      .map((item) => Date.parse(item.createdAt))
      .filter((time) => Number.isFinite(time))
    if (times.length === 0) return null
    return Math.floor((now - Math.min(...times)) / DAY_MS)
  }

  /** Espaço liberado pelo modo; 0 se não há o que apagar (sem Vídeo no disco, ou sem áudio no modo Só vídeo). */
  private async bytesFor(item: MeetingListItem, request: CleanupRequest): Promise<number> {
    if (request.mode === 'video') {
      const [video, audio] = await Promise.all([
        fileBytes(join(item.folder, MEETING_FILES.video)),
        fileBytes(join(item.folder, MEETING_FILES.audio))
      ])
      return audio > 0 ? video : 0
    }
    return (await scanFolder(item.folder))?.sizeBytes ?? 0
  }
}
