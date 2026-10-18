import { mkdir } from 'node:fs/promises'
import type { RecordingError, Result } from '@shared/recording'
import type {
  MeetingsDirChoice,
  RelocationProgress,
  RelocationRequest,
  RelocationSummary
} from '@shared/relocation'
import { sameFolder } from './paths'
import {
  listMeetingFolders,
  relocateMeetings,
  validateNewDir,
  type MeetingFolderInfo,
  type RelocateOps
} from './relocate'

export interface RelocationDeps {
  /** Pasta efetiva das Reuniões agora. */
  currentDir(): string
  /** Abre o seletor de pasta do sistema; `null` se o usuário cancelou. */
  chooseFolder(defaultPath: string): Promise<string | null>
  /** Motivo (texto para o usuário) que impede mexer nas pastas agora, ou `null`. */
  busyReason(): string | null
  /** Para o que mexe nas pastas (Compactação, miniaturas, índice) e espera largar os arquivos. */
  pause(): Promise<void>
  /** Retoma o que foi pausado; roda depois que a pasta nova já vale. */
  resume(): void
  /** Grava a nova pasta nas configurações. */
  commit(newDir: string): Promise<void>
  emit(progress: RelocationProgress): void
  ops?: RelocateOps
  now?: () => number
  log(message: string): void
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

/** Troca da pasta das Reuniões, com a opção de levar as Reuniões existentes junto. */
export class MeetingsRelocation {
  private chosen: string | null = null
  private running = false
  private cancelRequested = false
  private previous: string | null = null

  constructor(private readonly deps: RelocationDeps) {}

  /** Há uma troca em andamento: o resto do app não deve mexer nas pastas. */
  get isRunning(): boolean {
    return this.running
  }

  /** Pasta que ficou para trás na última troca (para "Abrir pasta antiga"). */
  previousDir(): string | null {
    return this.previous
  }

  /** Para depois da Reunião em andamento; as seguintes ficam na pasta antiga. */
  cancel(): void {
    if (this.running) this.cancelRequested = true
  }

  /** Abre o seletor, valida a pasta e mede o que há para mover. `null` = o usuário cancelou. */
  async choose(): Promise<Result<MeetingsDirChoice | null>> {
    const blocked = this.blocked()
    if (blocked) return blocked
    const currentDir = this.deps.currentDir()
    const picked = await this.deps.chooseFolder(currentDir)
    if (picked === null) return { ok: true, value: null }
    const validated = await validateNewDir(currentDir, picked)
    if (!validated.ok) return validated
    const meetings = await listMeetingFolders(currentDir)
    const choice: MeetingsDirChoice = {
      currentDir,
      newDir: validated.value,
      meetingCount: meetings.length,
      totalBytes: meetings.reduce((sum, meeting) => sum + meeting.bytes, 0)
    }
    this.chosen = validated.value
    return { ok: true, value: choice }
  }

  async apply(request: RelocationRequest): Promise<Result<RelocationSummary>> {
    const blocked = this.blocked()
    if (blocked) return blocked
    if (
      typeof request.newDir !== 'string' ||
      this.chosen === null ||
      !sameFolder(this.chosen, request.newDir)
    ) {
      return fail('invalid-request', 'Escolha a pasta de novo.')
    }
    const newDir = this.chosen
    const previousDir = this.deps.currentDir()
    this.running = true
    this.cancelRequested = false
    try {
      await this.deps.pause()
      const validated = await validateNewDir(previousDir, newDir)
      if (!validated.ok) return validated
      const meetings: MeetingFolderInfo[] =
        request.move === true ? await listMeetingFolders(previousDir) : []
      await mkdir(newDir, { recursive: true })
      const result = await relocateMeetings({
        to: newDir,
        meetings,
        ...(this.deps.ops ? { ops: this.deps.ops } : {}),
        ...(this.deps.now ? { now: this.deps.now } : {}),
        shouldCancel: () => this.cancelRequested,
        onProgress: (progress) => this.deps.emit(progress),
        log: (message) => this.deps.log(message)
      })
      try {
        await this.deps.commit(newDir)
      } catch (error) {
        this.deps.log(
          `[pasta] não salvou a nova pasta: ${error instanceof Error ? error.message : String(error)}`
        )
        return fail('unknown', 'Não foi possível salvar a nova pasta.')
      }
      this.previous = previousDir
      return {
        ok: true,
        value: {
          previousDir,
          newDir,
          moveRequested: request.move === true,
          total: meetings.length,
          ...result
        }
      }
    } finally {
      this.running = false
      this.cancelRequested = false
      this.chosen = null
      this.deps.resume()
    }
  }

  private blocked(): { ok: false; error: RecordingError } | null {
    if (this.running) return fail('busy', 'A pasta já está sendo trocada.')
    const reason = this.deps.busyReason()
    return reason ? fail('busy', reason) : null
  }
}
